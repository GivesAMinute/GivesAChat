// public/overlay/popups/modules/websocketPopups.js

import sharedPopups, { loadVeloraAccessToken, sendToChatOverlay } from "/overlay/shared/_sharedPopups.js";
import { handleRewardPopup } from "./rewardRendererPopups.js";
import { renderVeloraAlertCard, loadVeloraFonts } from "./veloraRendererPopups.js";
import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   ⭐ Popups Socket Manager — Velora Reconnect Enabled
--------------------------------------------------------- */
class PopupsSocketManager {
  constructor({ type, url, token = null, onEvent }) {
    this.type = type;
    this.url = url;
    this.token = token;
    this.onEvent = onEvent;

    this.socket = null;
    this.ready = false;

    this.reconnectTimer = null;
    this.backoff = 500;

    setTimeout(() => this.connect(), 100);
  }

  connect() {
    clearTimeout(this.reconnectTimer);

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

        this.onEvent(payload);
      } catch {
        // Non‑JSON messages still wake the overlay
        sharedPopups.wake();
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

    sendToChatOverlay({
      type: "velora_system",
      event: "channel.stream_alert",
      data: {
        alertType: data.alertType,
        displayName: data.displayName,
        username: data.username,
        count: t.amount || null,
        viewers: t.viewers || null,
        volts: t.amount || null,
        tier: t.tier || null,
        months: t.months || null,
        message: data.message || null,
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
   ⭐ Setup Popups Socket — FINAL NEVER-SLEEP VERSION
--------------------------------------------------------- */
export async function setupPopupSocket() {
  await loadVeloraFonts();

  const doManager = new PopupsSocketManager({
    type: "do",
    url: sharedPopups.wsURL,
    onEvent: (payload) => {
      sharedPopups.wake();   // ⭐ WAKE POPUPS
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
      sharedPopups.wake();   // ⭐ WAKE POPUPS
      handleVeloraEvent(payload);
    }
  });
}
