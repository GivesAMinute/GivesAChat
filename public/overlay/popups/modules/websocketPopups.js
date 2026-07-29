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
   ⭐ Velora Event Handler (popup + stripped-back chat forwarding)
--------------------------------------------------------- */
function handleVeloraEvent({ event, data, timestamp }) {
  const isAlert =
    event === "channel.stream_alert" ||
    event === "channel.follow" ||
    event === "channel.subscribe" ||
    event === "channel.subscription.gift" ||
    event === "channel.raid" ||
    event === "channel.volts";

  if (isAlert) {
    // Full popup card (unchanged)
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

    // ⭐ Map real Velora payload fields into what chatRenderer expects
    let alertType =
      data.alertType ||
      data.type ||
      event.replace("channel.", "");

    let displayName = data.displayName || data.username || null;
    let username = data.username || data.displayName || null;
    let count = null;
    let viewers = null;
    let volts = null;

    switch (event) {
      case "channel.follow":
        alertType = "follow";
        // displayName / username already set above
        break;

      case "channel.subscribe":
        alertType = "subscribe";
        // tier / months exist in data, but your current renderer
        // hardcodes "Tier 1!" and doesn't use months yet.
        // If you want dynamic tier/months, we can tweak the renderer next.
        break;

      case "channel.subscription.gift":
        alertType = "gift";
        displayName = data.gifterDisplayName || data.gifterUsername || displayName;
        username = data.gifterUsername || data.gifterDisplayName || username;
        count = data.quantity || data.count || null;
        break;

      case "channel.raid":
        alertType = "raid";
        displayName = data.fromDisplayName || data.fromUsername || displayName;
        username = data.fromUsername || data.fromDisplayName || username;
        viewers = data.viewerCount || data.viewers || null;
        break;

      case "channel.volts":
        alertType = "volts";
        // amount is available as data.amount; renderer currently
        // just says "sent volts!" without the number.
        volts = data.amount || null;
        break;

      default:
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
        message: null,
        customSoundUrl: data.customSoundUrl || null
      }
    });

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

    sendToChatOverlay({
      type: "velora_system",
      event: "channel.stream_alert",
      data: {
        alertType:
          payload.alertType ||
          payload.type ||
          card.type.replace("channel.", ""),

        displayName: payload.displayName || payload.username || null,
        username: payload.username || payload.displayName || null,

        count: payload.count || payload.amount || payload.total || null,
        viewers: payload.viewers || null,

        message: null,
        customSoundUrl: payload.customSoundUrl || null
      }
    });
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

  // Chat WS restored (Velora Finished architecture)
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
