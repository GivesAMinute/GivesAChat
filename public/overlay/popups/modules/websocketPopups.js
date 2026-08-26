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

   Socket.IO used to reconnect on its own while scheduleReconnect()
   layered a second mechanism over the top, each building a fresh
   io(). Two owners for one socket: if a connection we had already
   replaced was revived, both stayed subscribed and every event
   arrived twice for the rest of the session.

   Its built-in reconnect is now off and ours is the only one, for
   the token reason written on the options object. Sockets are also
   generation-stamped so a superseded one cannot deliver anything.

   The tag stays regardless, because it is what tells the two
   causes apart: the same tag twice is Velora repeating itself,
   two different tags is a leak on our side.
--------------------------------------------------------- */
let managerSeq = 0;

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   ⭐ Popups Socket Manager
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
  constructor({ type, url, getToken = null, onEvent, onSocket = null }) {
    this.type = type;
    this.url = url;
    this.getToken = getToken;
    this.token = null;
    this.onEvent = onEvent;

    /* Called with every socket this manager creates.

       Needed because a socket read once at setup is a socket that
       is null forever: connect() is deferred by 100ms, and every
       reconnect replaces it afterwards. Anything holding the
       original reference is holding a value that was never valid. */
    this.onSocket = onSocket;

    this.instance = ++managerSeq;
    this.gen = 0;
    this.connecting = false;

    this.socket = null;
    this.ready = false;

    this.reconnectTimer = null;
    this.backoff = 500;

    setTimeout(() => this.connect(), 100);
  }

  /* ---------------------------------------------------------
     ⭐ EVERY SOCKET CARRIES THE GENERATION THAT CREATED IT.

     connect() awaits getToken(). If the socket drops during that
     await, scheduleReconnect() fires and calls connect() again —
     and now two connects are in flight, each about to build its
     own io(). Both would subscribe, and every event would arrive
     twice for the rest of the session.

     Three guards, because one is not enough:

       connecting   single-flight, so overlapping calls collapse
       teardown()   the previous socket is killed before a new one
       gen          any handler from a superseded socket no-ops

     The generation stamp is the one that cannot be defeated. Even
     if a socket we thought was dead is revived by machinery we do
     not control, its listeners compare their generation against
     the current one and return.
  --------------------------------------------------------- */
  async connect() {
    clearTimeout(this.reconnectTimer);

    if (this.connecting) return;
    this.connecting = true;

    try {
      await this._connect();
    } finally {
      this.connecting = false;
    }
  }

  teardown() {
    const s = this.socket;
    if (!s) return;
    this.socket = null;

    try {
      if (this.type === "velora") {
        s.removeAllListeners();
        s.disconnect();
      } else {
        s.close();
      }
    } catch {}
  }

  async _connect() {
    this.teardown();
    const myGen = ++this.gen;
    const tag = `${this.type}#${this.instance}.g${myGen}`;

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
            /* ⭐ OFF ON PURPOSE. Socket.IO's own reconnect reuses
               the auth object it was constructed with — and Velora
               tokens die after an hour, so every silent retry after
               that reconnects with a dead token.

               That is why the custom reconnect below exists: it
               refetches the token first. Running both meant two
               mechanisms racing to replace the same socket, which
               is how a duplicate could survive. One owner now. */
            reconnection: false,
            timeout: 5000
          }
        : undefined;

    this.socket =
      this.type === "velora"
        ? io(this.url, opts)
        : new WebSocket(this.url);

    this.onSocket?.(this.socket);

    /* ---------------------------------------------------------
       ⭐ SOCKET.IO (Velora) — reconnect owned by scheduleReconnect
--------------------------------------------------------- */
    if (this.type === "velora") {
      this.socket.on("connect", () => {
        if (myGen !== this.gen) return;
        this.ready = true;
        this.backoff = 500;
      });

      this.socket.on("disconnect", () => {
        if (myGen !== this.gen) return;
        this.ready = false;
        this.scheduleReconnect();
      });

      this.socket.on("connect_error", () => {
        if (myGen !== this.gen) return;
        this.ready = false;
        this.scheduleReconnect();
      });

      this.socket.on("event", (payload) => {
        if (myGen !== this.gen) return;   // superseded socket
        this.ready = true;

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
      if (myGen !== this.gen) return;
      this.ready = true;
      this.backoff = 500;
    });

    this.socket.addEventListener("close", () => {
      if (myGen !== this.gen) return;
      this.ready = false;
      this.scheduleReconnect();
    });

    this.socket.addEventListener("error", () => {
      if (myGen !== this.gen) return;
      this.ready = false;
      this.scheduleReconnect();
    });

    this.socket.addEventListener("message", (event) => {
      if (myGen !== this.gen) return;
      try {
        const payload = JSON.parse(event.data);

        // ⭐ WAKE POPUPS OVERLAY
        sharedPopups.wake();

        // ⭐ MARK ACTIVITY
        sharedPopups.markPopupEvent();

        this.onEvent(payload, tag);
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

  /* ---------------------------------------------------------
     ⭐ SEND THE RAW SOCKET PAYLOAD SOMEWHERE IT CAN BE READ.

     This console line has existed all along and is useless in
     practice: it lives in a browser source nobody can watch
     mid-stream, which is why the popup has now been "fixed" three
     times against a payload never actually inspected.

     Posting it to the worker puts it in the same log as the
     webhook copy, readable afterwards at /api/velora/alert-log.

     Alerts only, fire and forget. A failed diagnostic must never
     delay the popup it is observing.
  --------------------------------------------------------- */
  if (event === "channel.raid" || event === "channel.stream_alert" || data?.alertType) {
    try {
      const key = new URLSearchParams(location.search).get("key") || "";
      fetch(`/api/velora/alert-sample?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, data })
      }).catch(() => {});
    } catch {}
  }

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

    /* ---------------------------------------------------------
       ⭐ ONLY RELAY AN ALERT WE CAN NAME.

       The chat lane is fed by two routes and the ChatRoom dedupe
       is first-wins, so the earlier arrival takes the slot. This
       overlay is always earlier — it hears Velora directly — and
       its Socket.IO payload for a raid has NO raider name. The
       worker's webhook does: data.raider.displayName.

       So the overlay kept winning a race with the worse copy, and
       every raid read "Someone raided!" while a perfectly good
       "net-TV raided with 2 viewers!" was discarded a beat later
       as the duplicate.

       Withdrawing from the race is simpler than trying to win it
       correctly. If this side cannot name the person, the worker's
       version is strictly better and should be allowed through.

       The POPUP still renders either way — that has always worked
       and is untouched. This governs the chat lane only.
    --------------------------------------------------------- */
    if (!name) {
      console.log("[VELORA] unnamed alert not relayed — the worker has a better copy");
      return;
    }

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

    /* Same rule as above — an unnamed card loses to the worker's. */
    if (!cardName) {
      console.log("[VELORA] unnamed cardAdded not relayed");
      return;
    }

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
    onSocket: (ws) => { sharedPopups.ws = ws; },
    onEvent: (payload) => {
      sharedPopups.wake();           // ⭐ WAKE POPUPS
      sharedPopups.markPopupEvent(); // ⭐ MARK ACTIVITY
      handlePopupBroadcast(payload);
    }
  });

  /* ---------------------------------------------------------
     ⭐ THIS USED TO READ sharedPopups.ws = doManager.socket

     Which captured null. The manager sets this.socket = null in
     its constructor and defers connect() by 100ms, so the value
     read here had not been created yet — and every reconnect
     replaced it afterwards anyway.

     Nothing looked broken, because popups kept working: the
     manager has its own socket and its own handlers. What broke
     was everything in _sharedPopups.js that reads sharedPopups.ws,
     and both of those start with `if (!ws) return`.

     So the 25 second heartbeat NEVER FIRED, not once. The socket
     had no keepalive, was dropped as idle, reconnected, and did it
     again — which is the connect/close churn showing up as a 71%
     error rate on PopupRoom.

     Assigned on every connect now, so the reference is always the
     live one.
  --------------------------------------------------------- */
  sharedPopups.reconnect = () => doManager.scheduleReconnect();

  sharedPopups.chatWS = new WebSocket(sharedPopups.chatWSURL);

  const veloraManager = new PopupsSocketManager({
    type: "velora",
    url: "wss://api.velora.tv/ws/events",

    // Passed as a function, not a value — a token captured here
    // would be stale within the hour and every reconnect would
    // fail silently.
    getToken: loadVeloraAccessToken,
    /* Both parameters, deliberately. The first version of this
       took only (payload) and dropped the socket tag on the floor,
       so every event logged "via ?" and the diagnostic answered
       nothing. */
    onEvent: (payload, tag) => {
      sharedPopups.wake();           // ⭐ WAKE POPUPS
      sharedPopups.markPopupEvent(); // ⭐ MARK ACTIVITY
      handleVeloraEvent(payload, tag);
    }
  });
}
