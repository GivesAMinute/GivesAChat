// public/overlay/popups/modules/websocketPopups.js

import sharedPopups, { loadVeloraAccessToken, sendToChatOverlay } from "/overlay/shared/_sharedPopups.js";
import { handleRewardPopup } from "./rewardRendererPopups.js";
import { renderVeloraAlertCard, loadVeloraFonts } from "./veloraRendererPopups.js";
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

/* ---------------------------------------------------------
   ⭐ POPUPS SOCKET MANAGER — Velora + DO
--------------------------------------------------------- */
class PopupsSocketManager {
  constructor({ type, url, token = null, onEvent }) {
    this.type = type;
    this.url = url;
    this.token = token;
    this.onEvent = onEvent;

    this.socket = null;
    this.backoff = 500;
    this.maxBackoff = 8000;
    this.heartbeat = null;

    this.queue = [];
    this.ready = false;

    this.connect();
  }

  connect() {
    console.log(`[Popups] Connecting ${this.type} socket…`);

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

    /* ---------------------------------------------------------
       ⭐ Velora (Socket.IO)
    --------------------------------------------------------- */
    if (this.type === "velora") {
      this.socket.on("connect", () => {
        console.log("[Popups] Velora connected");
        this.ready = true;
        this.backoff = 500;
        this.flushQueue();
        this.startHeartbeat();
      });

      this.socket.on("connect_error", () => {
        console.warn("[Popups] Velora connect error");
        this.ready = false;
        this.reconnect();
      });

      this.socket.on("disconnect", () => {
        console.warn("[Popups] Velora disconnected");
        this.ready = false;
        this.reconnect();
      });

      this.socket.on("event", (payload) => {
        this.onEvent(payload);
      });

      return;
    }

    /* ---------------------------------------------------------
       ⭐ DO WebSocket (native)
    --------------------------------------------------------- */
    this.socket.addEventListener("open", () => {
      console.log("[Popups] DO WebSocket connected");
      this.ready = true;
      this.backoff = 500;
      this.flushQueue();
      this.startHeartbeat();
    });

    this.socket.addEventListener("close", () => {
      console.warn("[Popups] DO WebSocket closed");
      this.ready = false;
      this.reconnect();
    });

    this.socket.addEventListener("error", () => {
      console.warn("[Popups] DO WebSocket error");
      this.ready = false;
      this.reconnect();
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.onEvent(payload);
      } catch (err) {
        console.error("[Popups] Error parsing DO payload:", err);
      }
    });
  }

  /* ---------------------------------------------------------
     ⭐ Reconnect with exponential backoff
  --------------------------------------------------------- */
  reconnect() {
    clearInterval(this.heartbeat);

    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 1.6, this.maxBackoff);

    console.warn(`[Popups] Reconnecting ${this.type} in ${delay}ms…`);

    try {
      if (this.socket && this.type !== "velora") {
        this.socket.close();
      }
    } catch {
      // ignore
    }

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /* ---------------------------------------------------------
     ⭐ Heartbeat
     - Velora: send ping
     - DO: just monitor, do NOT keep it alive
  --------------------------------------------------------- */
  startHeartbeat() {
    clearInterval(this.heartbeat);

    this.heartbeat = setInterval(() => {
      if (!this.ready || !this.socket) return;

      if (this.type === "velora") {
        this.socket.emit("ping");
      } else {
        // DO socket: if it closes, reconnect; no keep-alive pings
        if (this.socket.readyState !== WebSocket.OPEN) {
          console.warn("[Popups] DO heartbeat detected closed socket");
          this.ready = false;
          this.reconnect();
        }
      }
    }, 5000);
  }

  /* ---------------------------------------------------------
     ⭐ Queue + Flush
  --------------------------------------------------------- */
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

  /* ---------------------------------------------------------
     ⭐ Wait until ready
  --------------------------------------------------------- */
  waitUntilReady() {
    return new Promise((resolve) => {
      if (this.ready) return resolve();

      const check = setInterval(() => {
        if (this.ready) {
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
  }
}

/* ---------------------------------------------------------
   ⭐ DO PAYLOAD HANDLER
--------------------------------------------------------- */
function handlePopupBroadcast(payload) {
  if (!payload.cardDesign) return;

  if (payload.type === "reward") {
    handleRewardPopup(payload);
  }
}

/* ---------------------------------------------------------
   ⭐ Velora Event Handler
--------------------------------------------------------- */
function handleVeloraEvent({ event, data, timestamp }) {
  console.log("[Popups] Velora event received:", event, data);

  /* STREAM ALERTS */
  if (
    event === "channel.stream_alert" ||
    event === "channel.follow" ||
    event === "channel.subscribe" ||
    event === "channel.subscription.gift" ||
    event === "channel.raid" ||
    event === "channel.volts"
  ) {
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

    sendToChatOverlay({
      type: "velora_system",
      event,
      data
    });

    return;
  }

  /* CHANNEL POINTS */
  if (event === "channel_point_redeem") {
    handleRewardPopup(data);

    sendToChatOverlay({
      type: "reward",
      platform: "velora",
      ...data
    });

    return;
  }

  /* CARD MESSAGES */
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
      event: card.type,
      data: payload
    });
  }
}

/* ---------------------------------------------------------
   ⭐ Combined initializer
--------------------------------------------------------- */
export async function setupPopupSocket() {
  console.log("[Popups] Starting overlay…");

  await loadVeloraFonts();

  /* ---------------------------------------------------------
     ⭐ DO SOCKET (with queue + reconnection)
  --------------------------------------------------------- */
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

  /* ---------------------------------------------------------
     ⭐ Chat Forward Socket
  --------------------------------------------------------- */
  const chatSocket = new WebSocket(sharedPopups.chatWSURL);
  sharedPopups.chatWS = chatSocket;

  chatSocket.addEventListener("open", () => {
    console.log("[Popups] Chat forward WS connected");
  });

  chatSocket.addEventListener("error", (err) => {
    console.error("[Popups] Chat forward WS error:", err);
  });

  chatSocket.addEventListener("close", () => {
    console.warn("[Popups] Chat forward WS closed");
  });

  /* ---------------------------------------------------------
     ⭐ Velora Events API (with queue + reconnection)
  --------------------------------------------------------- */
  const token = await loadVeloraAccessToken();
  if (!token) {
    console.warn("[Popups] Velora Events API not started — no token available");
    return;
  }

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
