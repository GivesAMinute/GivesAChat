// public/overlay/popups/modules/websocketPopups.js

import sharedPopups, { loadVeloraAccessToken, sendToChatOverlay } from "/overlay/shared/_sharedPopups.js";
import { handleRewardPopup } from "./rewardRendererPopups.js";
import { renderVeloraAlertCard, loadVeloraFonts } from "./veloraRendererPopups.js";
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

/* ---------------------------------------------------------
   ⭐ Detect iOS (Safari WebKit)
--------------------------------------------------------- */
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   ⭐ Popups Socket Manager
--------------------------------------------------------- */
class PopupsSocketManager {
  constructor({ type, url, token = null, onEvent }) {
    this.type = type;
    this.url = url;
    this.token = token;
    this.onEvent = onEvent;

    this.socket = null;
    this.heartbeat = null;
    this.queue = [];
    this.ready = false;
    this.reconnectTimer = null;

    setTimeout(() => {
      this.connect();
    }, 100);
  }

  connect() {
    const opts =
      this.type === "velora"
        ? {
            auth: { token: this.token },
            transports: ["websocket"],
            reconnection: false,
            timeout: 5000
          }
        : undefined;

    this.socket =
      this.type === "velora"
        ? io(this.url, opts)
        : new WebSocket(this.url);

    if (this.type === "velora") {
      this.socket.on("connect", () => {
        this.ready = true;
        this.flushQueue();
        this.startHeartbeat();
      });

      this.socket.on("connect_error", () => {
        this.ready = false;
        this.reconnect();
      });

      this.socket.on("disconnect", () => {
        this.ready = false;
        this.reconnect();
      });

      this.socket.on("event", (payload) => {
        this.onEvent(payload);
      });

      return;
    }

    this.socket.addEventListener("open", () => {
      this.ready = true;
      this.flushQueue();
      this.startHeartbeat();
    });

    this.socket.addEventListener("close", () => {
      this.ready = false;
      this.reconnect();
    });

    this.socket.addEventListener("error", () => {
      this.ready = false;
      this.reconnect();
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.onEvent(payload);
      } catch {}
    });
  }

  reconnect() {
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnectTimer);

    try {
      if (this.socket && this.type !== "velora") {
        this.socket.close();
      }
    } catch {}

    const delay = isIOS ? 1500 : 300;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  startHeartbeat() {
    clearInterval(this.heartbeat);

    this.heartbeat = setInterval(() => {
      if (!this.ready || !this.socket) return;

      if (this.type === "velora") {
        this.socket.emit("ping");
      } else {
        if (this.socket.readyState !== WebSocket.OPEN) {
          this.ready = false;
          this.reconnect();
        }
      }
    }, 3000);
  }

  queueMessage(msg) {
    this.queue.push(msg);
  }

  flushQueue() {
    if (!this.ready) return;

    while (this.queue.length > 0) {
      const msg = this.queue.shift();
      this.onEvent(msg);
    }
  }
}

/* ---------------------------------------------------------
   ⭐ Popup Broadcast Handler
--------------------------------------------------------- */
function handlePopupBroadcast(payload) {
  if (!payload.cardDesign) return;

  if (payload.type === "reward") {
    handleRewardPopup(payload);
  }
}

/* ---------------------------------------------------------
   ⭐ Correct Velora → Chat Mapping (ALL event types)
--------------------------------------------------------- */
function forwardVeloraToChat(event, data) {

  let alertType = null;
  let displayName = null;
  let username = null;
  let count = null;
  let viewers = null;
  let volts = null;
  let tier = null;
  let months = null;

  switch (event) {

    case "channel.follow":
      alertType = "follow";
      displayName = data.displayName;
      username = data.username;
      break;

    case "channel.subscribe":
      alertType = data.months && data.months > 1 ? "resub" : "subscribe";
      displayName = data.displayName;
      username = data.username;
      tier = data.tier || "1";
      months = data.months || 1;
      break;

    case "channel.subscription.gift":
      alertType = "gift";
      displayName = data.gifterDisplayName;
      username = data.gifterUsername;
      count = data.quantity || 1;
      tier = data.tier || "1";
      break;

    case "channel.raid":
      alertType = "raid";
      displayName = data.fromDisplayName;
      username = data.fromUsername;
      viewers = data.viewerCount || 0;
      break;

    case "channel.volts":
      alertType = "volts";
      displayName = data.displayName;
      username = data.username;
      volts = data.amount || 0;
      break;

    default:
      alertType = "generic";
      displayName = data.displayName || data.username;
      username = data.username || data.displayName;
      break;
  }

  sendToChatOverlay({
    type: "velora_system",
    event: "channel.stream_alert",
    data: {
      alertType,
      displayName,
      username,
      count,
      viewers,
      volts,
      tier,
      months,
      message: null,
      customSoundUrl: data.customSoundUrl || null
    }
  });
}

/* ---------------------------------------------------------
   ⭐ Velora Event Handler (popup + chat)
--------------------------------------------------------- */
function handleVeloraEvent({ event, data, timestamp }) {

  const isAlert =
    event === "channel.follow" ||
    event === "channel.subscribe" ||
    event === "channel.subscription.gift" ||
    event === "channel.raid" ||
    event === "channel.volts";

  if (isAlert) {

    // Popup overlay full card
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

    // ⭐ Correct stripped-back chat payload
    forwardVeloraToChat(event, data);

    return;
  }

  if (event === "channel_point_redeem") {
    handleRewardPopup(data);

    sendToChatOverlay({
      type: "reward",
      platform: "velora",
      ...data
    });

    return;
  }

  // Card messages (stickers, sounds, celebrations)
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

    forwardVeloraToChat(card.type, payload);
  }
}

/* ---------------------------------------------------------
   ⭐ Setup Popups Socket
--------------------------------------------------------- */
export async function setupPopupSocket() {
  await loadVeloraFonts();

  const doManager = new PopupsSocketManager({
    type: "do",
    url: sharedPopups.wsURL,
    onEvent: (payload) => {
      if (!doManager.ready) {
        doManager.queueMessage(payload);
        return;
      }
      handlePopupBroadcast(payload);
    }
  });

  sharedPopups.ws = doManager.socket;

  // Chat WS (Velora Finished architecture)
  sharedPopups.chatWS = new WebSocket(sharedPopups.chatWSURL);

  const token = await loadVeloraAccessToken();
  if (!token) return;

  const veloraManager = new PopupsSocketManager({
    type: "velora",
    url: "wss://api.velora.tv/ws/events",
    token,
    onEvent: (payload) => {
      if (!veloraManager.ready) {
        veloraManager.queueMessage(payload);
        return;
      }
      handleVeloraEvent(payload);
    }
  });
}
