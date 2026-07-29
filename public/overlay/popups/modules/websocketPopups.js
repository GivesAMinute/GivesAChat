// public/overlay/popups/modules/websocketPopups.js

import sharedPopups, { loadVeloraAccessToken, sendToChatOverlay } from "/overlay/shared/_sharedPopups.js";
import { handleRewardPopup } from "./rewardRendererPopups.js";
import { renderVeloraAlertCard, loadVeloraFonts } from "./veloraRendererPopups.js";
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   Socket Manager (unchanged)
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

    setTimeout(() => this.connect(), 100);
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
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
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
   Popup Broadcast Handler
--------------------------------------------------------- */
function handlePopupBroadcast(payload) {
  if (!payload.cardDesign) return;

  if (payload.type === "reward") {
    handleRewardPopup(payload);
  }
}

/* ---------------------------------------------------------
   ⭐ Velora Event Handler (FINAL WORKING VERSION)
--------------------------------------------------------- */
function handleVeloraEvent({ event, data, timestamp }) {

  console.log("[VELORA RAW EVENT]", event, JSON.stringify(data, null, 2));

  // Velora ALWAYS sends channel.stream_alert for alerts
  if (event === "channel.stream_alert") {

    // Popup overlay (unchanged)
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

    // ⭐ Extract correct fields from templateData
    const t = data.templateData || {};

    const chatData = {
      alertType: data.alertType,          // "follow", "subscription", "gift_sub", "resub", "raid", "volts"
      displayName: data.displayName,
      username: data.username,

      // Numbers come from templateData
      count: t.amount || null,            // gift_sub amount
      viewers: t.viewers || null,         // raid viewers
      volts: t.amount || null,            // volts amount
      tier: t.tier || null,               // subscription tier
      months: t.months || null,           // resub months

      // Final message text
      message: data.message || null,

      customSoundUrl: data.customSoundUrl || null
    };

    // ⭐ MUST stay channel.stream_alert or chatRenderer ignores it
    sendToChatOverlay({
      type: "velora_system",
      event: "channel.stream_alert",
      data: chatData
    });

    return;
  }

  // Channel points (unchanged)
  if (event === "channel_point_redeem") {
    handleRewardPopup(data);

    sendToChatOverlay({
      type: "reward",
      platform: "velora",
      ...data
    });

    return;
  }

  // Card messages (unchanged)
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
        alertType: payload.alertType || payload.type,
        displayName: payload.displayName || payload.username,
        username: payload.username || payload.displayName,
        message: payload.message || null,
        customSoundUrl: payload.customSoundUrl || null
      }
    });
  }
}

/* ---------------------------------------------------------
   Setup Popups Socket (unchanged)
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
