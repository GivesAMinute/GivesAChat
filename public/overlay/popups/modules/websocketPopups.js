// public/overlay/popups/modules/websocketPopups.js

import sharedPopups, { loadVeloraAccessToken, sendToChatOverlay } from "/overlay/shared/_sharedPopups.js";
import { handleRewardPopup } from "./rewardRendererPopups.js";
import { renderVeloraAlertCard, loadVeloraFonts } from "./veloraRendererPopups.js";
import { isClaimRedemption, renderClaimAlert } from "./claimAlerts.js";
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

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

    this.socket = null;
    this.ready = false;

    this.reconnectTimer = null;
    this.backoff = 500;

    setTimeout(() => this.connect(), 100);
  }

  async connect() {
    clearTimeout(this.reconnectTimer);

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

        // ⭐ WAKE POPUPS OVERLAY
        sharedPopups.wake();

        // ⭐ MARK ACTIVITY (Zombie detector)
        sharedPopups.markPopupEvent();

        this.onEvent(payload);
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
   ⭐ ONE ALERT, TWO MESSAGES.

   A real raid produced two cards in the chat lane:

     "undefined raided with 8 viewers!"
     "null raided with viewers!"

   They came from the two branches below, which are mutually
   exclusive per message — so Velora sent the same raid TWICE, once
   as a channel.stream_alert (carrying templateData.viewers = 8)
   and once as a cardAdded (carrying neither name nor count). Each
   branch relayed its own version to chat.

   The popup itself is fine; it is only the relay that doubles up.
   So the relay gets a short memory: the first version of an alert
   wins and anything matching within the window is dropped.

   First-wins is deliberate rather than incidental. The
   stream_alert arrives first and is the richer payload — it is the
   one with templateData on it — so preferring the earlier message
   also keeps the better one.

   Keyed on type AND name so two genuine follows seconds apart both
   still render. When the name is missing the key falls back to the
   type alone, which is what makes the raid case collapse correctly.
--------------------------------------------------------- */
const ALERT_DEDUPE_MS = 6000;
const recentChatAlerts = new Map();

function relayAlertToChat(alertType, name, payload) {
  const now = Date.now();

  for (const [k, at] of recentChatAlerts) {
    if (now - at > ALERT_DEDUPE_MS) recentChatAlerts.delete(k);
  }

  const key = name
    ? `${alertType || "unknown"}|${name.toLowerCase()}`
    : String(alertType || "unknown");

  if (recentChatAlerts.has(key)) {
    console.log(`[VELORA] duplicate ${key} suppressed in the chat relay`);
    return;
  }

  recentChatAlerts.set(key, now);
  sendToChatOverlay(payload);
}

/* Velora does not put the name in one predictable place — the raid
   above had it in neither displayName nor username. templateData
   carried the viewer count, so the substitution variables live
   there and the name plausibly does too. Returns null rather than
   a placeholder, so the dedupe key can tell "no name" apart from a
   viewer actually called Someone. */
function resolveAlertName(src = {}) {
  const t = src.templateData || {};

  const candidates = [
    src.displayName, src.username,
    src.user?.displayName, src.user?.username,
    src.from?.displayName, src.from?.username,
    src.raider?.displayName, src.raider?.username,
    t.displayName, t.username, t.user, t.name, t.User
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  return null;
}

/* ---------------------------------------------------------
   ⭐ Velora Event Handler
--------------------------------------------------------- */
function handleVeloraEvent({ event, data, timestamp }) {
  console.log("[VELORA RAW EVENT]", event, JSON.stringify(data, null, 2));

  if (event === "channel.stream_alert") {
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

    relayAlertToChat(data.alertType, name, {
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

    relayAlertToChat(cardType, cardName, {
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
