// public/overlay/popups/modules/websocketPopups.js

import sharedPopups, { loadVeloraAccessToken, sendToChatOverlay } from "/overlay/shared/_sharedPopups.js";
import { handleRewardPopup } from "./rewardRendererPopups.js";
import { renderVeloraAlertCard, loadVeloraFonts } from "./veloraRendererPopups.js";
import { isClaimRedemption, renderClaimAlert } from "./claimAlerts.js";
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

/* ---------------------------------------------------------
   ⭐ WHICH SOCKET DELIVERED THIS?

   A test alert logged twice (Chrome's "2" badge). Two very
   different causes produce that, and they need opposite fixes:

     Velora sends the event twice  -> dedupe on our side
     WE have two live sockets      -> fix the reconnect, and
                                      deduping would only hide it

   Socket.IO already reconnects on its own (reconnection: true,
   reconnectionAttempts: Infinity) and scheduleReconnect() layers
   a second mechanism over the top, building a NEW io() each time.
   If a disconnected socket is ever revived by Socket.IO's own
   retry while we have already replaced it, both stay subscribed
   and every event arrives twice, forever.

   So each manager carries an identity, and every event says which
   socket and which connection attempt it came in on. One test
   alert now answers the question outright: the same tag twice is
   Velora repeating itself, two different tags is our leak.
--------------------------------------------------------- */
let managerSeq = 0;

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   ⭐ Popups Socket Manager — Velora Reconnect Enabled
--------------------------------------------------------- */
class PopupsSocketManager {
  /**
   * @param {object}   opts
   * @param {function} [opts.getToken]  async, called before EVERY
   *   connect. Velora access tokens expire after an hour, so a token
   *   captured once and reused on reconnect is dead by the second
   *   attempt — which is why the overlay needed a manual refresh
   *   before alerts would render again.
   */
  constructor({ type, url, getToken = null, onEvent }) {
    this.type = type;
    this.url = url;
    this.getToken = getToken;
    this.token = null;
    this.onEvent = onEvent;

    this.instance = ++managerSeq;
    this.connects = 0;

    this.socket = null;
    this.ready = false;

    this.reconnectTimer = null;
    this.backoff = 500;

    setTimeout(() => this.connect(), 100);
  }

  async connect() {
    clearTimeout(this.reconnectTimer);
    this.connects++;

    // Always fetch a fresh token — the previous one may have expired
    // while we were disconnected.
    if (this.type === "velora" && this.getToken) {
      try {
        this.token = await this.getToken();
      } catch (err) {
        console.warn("[Popups] token fetch failed:", err);
      }

      if (!this.token) {
        console.warn("[Popups] no Velora token; retrying");
        this.scheduleReconnect();
        return;
      }
    }

    const opts =
      this.type === "velora"
        ? {
            auth: { token: this.token },
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 500,
            reconnectionDelayMax: 8000,
            timeout: 5000
          }
        : undefined;

    this.socket =
      this.type === "velora"
        ? io(this.url, opts)
        : new WebSocket(this.url);

    /* ---------------------------------------------------------
       ⭐ SOCKET.IO (Velora) — RECONNECT ENABLED
--------------------------------------------------------- */
    if (this.type === "velora") {
      this.socket.on("connect", () => {
        this.ready = true;
        this.backoff = 500;
      });

      this.socket.on("disconnect", () => {
        this.ready = false;
        this.scheduleReconnect();
      });

      this.socket.on("connect_error", () => {
        this.ready = false;
        this.scheduleReconnect();
      });

      this.socket.on("event", (payload) => {
        this.ready = true;
        const tag = `${this.type}#${this.instance}.c${this.connects}`;

        // ⭐ WAKE POPUPS OVERLAY
        sharedPopups.wake();

        // ⭐ MARK ACTIVITY (Zombie detector)
        sharedPopups.markPopupEvent();

        this.onEvent(payload, tag);
      });

      return;
    }

    /* ---------------------------------------------------------
       ⭐ RAW WEBSOCKET (Cloudflare Worker)
       ANY message is a valid wake event.
--------------------------------------------------------- */
    this.socket.addEventListener("open", () => {
      this.ready = true;
      this.backoff = 500;
    });

    this.socket.addEventListener("close", () => {
      this.ready = false;
      this.scheduleReconnect();
    });

    this.socket.addEventListener("error", () => {
      this.ready = false;
      this.scheduleReconnect();
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);

        // ⭐ WAKE POPUPS OVERLAY
        sharedPopups.wake();

        // ⭐ MARK ACTIVITY
        sharedPopups.markPopupEvent();

        this.onEvent(payload);
      } catch {
        // Non‑JSON messages still wake the overlay
        sharedPopups.wake();
        sharedPopups.markPopupEvent();
      }
    });
  }

  /* ---------------------------------------------------------
     ⭐ RECONNECT WITH BACKOFF — ONLY WHEN SOCKET CLOSES
--------------------------------------------------------- */
  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);

    try {
      if (this.socket) {
        if (this.type === "velora") {
          this.socket.disconnect();
        } else {
          this.socket.close();
        }
      }
    } catch {}

    this.backoff = Math.min(this.backoff * 1.5, 8000);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.backoff);
  }
}

/* ---------------------------------------------------------
   Popup Broadcast Handler
--------------------------------------------------------- */
function handlePopupBroadcast(payload) {
  if (!payload.cardDesign) return;

  if (payload.type === "reward") {
    handleRewardPopup(payload);
  }
}

/* ---------------------------------------------------------
   ⭐ ONE ALERT, TWO DELIVERIES.

   A real raid produced two cards in the chat lane:

     "undefined raided with 8 viewers!"
     "null raided with viewers!"

   An earlier version of this comment claimed "the popup itself is
   fine; it is only the relay that doubles up." That was an
   assumption, and it was wrong. A test alert logged twice, and the
   log sits ABOVE both the popup render and the relay — so whatever
   is duplicating, it duplicates both.

   The dedupe therefore guards the whole event, not just the relay.

   First-wins, on a six second window. Keyed on type AND name so
   two genuine follows seconds apart both still render — but a
   nameless alert matches any recent alert of its type, and a named
   one matches an earlier nameless alert of its type. That
   asymmetry is the point: the two deliveries do not agree about
   the name, which is exactly why keying on type+name alone let
   both through in the first version.
--------------------------------------------------------- */
const ALERT_DEDUPE_MS = 6000;
const recentChatAlerts = new Map();

function isDuplicateAlert(alertType, name) {
  const now = Date.now();

  for (const [k, at] of recentChatAlerts) {
    if (now - at > ALERT_DEDUPE_MS) recentChatAlerts.delete(k);
  }

  const type = String(alertType || "unknown");
  const key = `${type}|${name ? name.toLowerCase() : ""}`;
  const anonKey = `${type}|`;

  const seen =
    recentChatAlerts.has(key) ||
    recentChatAlerts.has(anonKey) ||
    (!name && [...recentChatAlerts.keys()].some((k) => k.startsWith(anonKey)));

  if (seen) {
    console.log(`[VELORA] duplicate ${type} alert suppressed`);
    return true;
  }

  recentChatAlerts.set(key, now);
  return false;
}



/* Confirmed against a real channel.stream_alert payload: the name
   is present in all four of displayName, username,
   templateData.displayName and templateData.username.

   Top level first, templateData behind it — that order matters,
   because the raid that caused this had nothing at the top level
   while templateData.viewers still held the count.

   Returns null rather than a placeholder so the dedupe key can
   tell "no name" apart from a viewer actually called Someone. */
function resolveAlertName(src = {}) {
  const t = src.templateData || {};

  const candidates = [
    src.displayName, src.username,
    t.displayName, t.username
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  return null;
}

/* ---------------------------------------------------------
   ⭐ Velora Event Handler
--------------------------------------------------------- */
function handleVeloraEvent({ event, data, timestamp }, source = "?") {
  console.log(`[VELORA RAW EVENT via ${source}]`, event, JSON.stringify(data, null, 2));

  if (event === "channel.stream_alert") {
    /* Guard sits ABOVE renderVeloraAlertCard deliberately — a
       duplicate delivery must not draw a second popup either. */
    if (isDuplicateAlert(data.alertType, resolveAlertName(data))) return;

    renderVeloraAlertCard({
      event,
      timestamp,
      cardDesign: data.cardDesign || {},
      customImageUrl: data.customImageUrl || null,
      customSoundUrl: data.customSoundUrl || null,
      customMediaTextFont: data.customMediaTextFont || null,
      customMediaTextScale: data.customMediaTextScale || "1.0",
      customMediaTextAlign: data.customMediaTextAlign || "center",
      message: data.message || null,
      duration: data.duration || null
    });

    const t = data.templateData || {};
    const name = resolveAlertName(data);

    sendToChatOverlay({
      type: "velora_system",
      event: "channel.stream_alert",
      data: {
        alertType: data.alertType,
        displayName: name,
        username: name,
        count: t.amount || null,
        viewers: t.viewers || null,
        volts: t.amount || null,
        tier: t.tier || null,
        months: t.months || null,
        message: data.message || null,
        customSoundUrl: data.customSoundUrl || null,

        /* Passed through so the renderer can dig for anything we
           have not learned the name of yet. Cheap, and it means a
           new Velora field does not need a deploy on both sides. */
        templateData: t
      }
    });

    return;
  }

  if (event === "channel_point_redeem") {
    /* -----------------------------------------------------
       ⭐ 1st / 2nd GIVER claims get their own treatment here
       and are deliberately NOT relayed to the chat overlay —
       they belong in popups only.
    ----------------------------------------------------- */
    if (isClaimRedemption(data)) {
      renderClaimAlert(data);
      return;
    }

    handleRewardPopup(data);

    sendToChatOverlay({
      type: "reward",
      platform: "velora",
      ...data
    });

    return;
  }

  if (data.cardAdded) {
    const card = data.cardAdded;
    const payload = card.payload || {};

    if (isDuplicateAlert(payload.alertType || payload.type,
                         resolveAlertName(payload))) return;

    renderVeloraAlertCard({
      event: card.type,
      timestamp,
      cardDesign: payload.cardDesign || {},
      customImageUrl: payload.customImageUrl || null,
      customSoundUrl: payload.customSoundUrl || null,
      customMediaTextFont: payload.customMediaTextFont || null,
      customMediaTextScale: payload.customMediaTextScale || "1.0",
      customMediaTextAlign: payload.customMediaTextAlign || "center",
      message: payload.message || null,
      duration: payload.duration || null
    });

    const cardName = resolveAlertName(payload);
    const cardType = payload.alertType || payload.type;

    sendToChatOverlay({
      type: "velora_system",
      event: "channel.stream_alert",
      data: {
        alertType: cardType,
        displayName: cardName,
        username: cardName,
        message: payload.message || null,
        customSoundUrl: payload.customSoundUrl || null,
        templateData: payload.templateData || {}
      }
    });
  }
}

/* ---------------------------------------------------------
   ⭐ Setup Popups Socket — FINAL NEVER-SLEEP VERSION
--------------------------------------------------------- */
export async function setupPopupSocket() {
  await loadVeloraFonts();

  const doManager = new PopupsSocketManager({
    type: "do",
    url: sharedPopups.wsURL,
    onEvent: (payload) => {
      sharedPopups.wake();           // ⭐ WAKE POPUPS
      sharedPopups.markPopupEvent(); // ⭐ MARK ACTIVITY
      handlePopupBroadcast(payload);
    }
  });

  sharedPopups.ws = doManager.socket;

  sharedPopups.chatWS = new WebSocket(sharedPopups.chatWSURL);

  const veloraManager = new PopupsSocketManager({
    type: "velora",
    url: "wss://api.velora.tv/ws/events",

    // Passed as a function, not a value — a token captured here
    // would be stale within the hour and every reconnect would
    // fail silently.
    getToken: loadVeloraAccessToken,
    onEvent: (payload) => {
      sharedPopups.wake();           // ⭐ WAKE POPUPS
      sharedPopups.markPopupEvent(); // ⭐ MARK ACTIVITY
      handleVeloraEvent(payload);
    }
  });
}
