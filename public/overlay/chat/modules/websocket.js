// public/overlay/chat/modules/websocket.js

import _shared from "../shared/_shared.js";
import { handleReward } from "./rewardRenderer.js";
import { handleChat, renderVeloraSystemMessage } from "./chatRenderer.js";
import { handleVeloraStreamAlert } from "./alertRenderer.js";

/* ---------------------------------------------------------
   ⭐ DEDUPE — 1 second window only
--------------------------------------------------------- */
let lastEvents = [];
const DEDUPE_WINDOW = 1000;

function isDuplicate(payload) {
  const now = Date.now();
  const key = {
    type: payload.type,
    event: payload.event,
    username: payload.data?.username,
    amount: payload.data?.amount,
    message: payload.data?.message
  };

  lastEvents = lastEvents.filter(e => now - e.ts < DEDUPE_WINDOW);

  for (const e of lastEvents) {
    if (
      e.type === key.type &&
      e.event === key.event &&
      e.username === key.username &&
      e.amount === key.amount &&
      e.message === key.message
    ) {
      return true;
    }
  }

  lastEvents.push({ ...key, ts: now });
  return false;
}

/* ---------------------------------------------------------
   ⭐ POPUP (unchanged)
--------------------------------------------------------- */
function showRewardPopup(payload) {
  const popupRoot = document.getElementById("reward-popup");
  if (!popupRoot) return;

  const popupIcon =
    payload.rewardIcon ||
    payload.icon?.customIconUrl ||
    payload.icon?.emoteUrl ||
    payload.itemIconUrl;

  if (!popupIcon) return;

  const img = document.createElement("img");
  img.className = "reward-popup-image";
  img.src = popupIcon;

  popupRoot.appendChild(img);

  setTimeout(() => {
    img.classList.add("fade-out");
    setTimeout(() => img.remove(), 800);
  }, 2500);
}

/* ---------------------------------------------------------
   ⭐ CHAT CONTAINER
--------------------------------------------------------- */
function getMessagesContainer() {
  return document.getElementById("messages");
}

/* ---------------------------------------------------------
   ⭐ BROADCAST HANDLER — FIXED
   Chat overlay must handle ALL events.
--------------------------------------------------------- */
function handleBroadcast(payload) {
  const container = getMessagesContainer();
  if (!container) return;

  // ⭐ Velora system messages (stream alerts, raids, etc.)
  if (payload.type === "velora_system") {
    renderVeloraSystemMessage(payload.event, payload.data, container);
    return;
  }

  // ⭐ Velora rewards
  if (payload.type === "reward" && payload.platform === "velora") {
    handleReward(payload, container);
    showRewardPopup(payload);
    return;
  }

  // ⭐ Chat messages (Velora + Beam + external)
  if (payload.type === "chat") {
    if (!payload.data || payload.platform === "velora") {
      handleChat(payload, container);
      return;
    }

    const merged = {
      platform: payload.platform,
      ...payload.data
    };

    handleChat(merged, container);
    return;
  }

  // ⭐ Velora stream alerts (popups + chat overlay)
  if (payload.type === "velora_alert") {
    handleVeloraStreamAlert(payload.data);
    return;
  }

  // ⭐ ANY OTHER EVENT (date, viewer count, etc.)
  if (payload.type === "system") {
    // system.date, system.viewer_count, etc.
    renderVeloraSystemMessage(payload.event, payload.data, container);
    return;
  }
}

/* ---------------------------------------------------------
   ⭐ MAIN OVERLAY WEBSOCKET — FIXED
--------------------------------------------------------- */
let socket = null;
let heartbeat = null;
let reconnectTimer = null;
let isReconnecting = false;

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setupSocket() {
  const wsURL = "wss://givesachat-cloudflare.benonkoebsch.workers.dev/ws/chat";

  if (socket && socket.readyState === WebSocket.OPEN) {
    try { socket.close(); } catch {}
  }

  setTimeout(() => {
    socket = new WebSocket(wsURL);

    socket.addEventListener("open", () => {
      startHeartbeat();
      console.log("[Overlay WS] Connected");
    });

    socket.addEventListener("close", () => {
      reconnect();
    });

    socket.addEventListener("error", () => {
      reconnect();
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (isDuplicate(payload)) return;
        handleBroadcast(payload);
      } catch {}
    });
  }, 100);
}

/* ---------------------------------------------------------
   ⭐ Heartbeat
--------------------------------------------------------- */
function startHeartbeat() {
  clearInterval(heartbeat);

  heartbeat = setInterval(() => {
    if (!socket) return;

    if (socket.readyState !== WebSocket.OPEN) {
      reconnect();
    }
  }, 3000);
}

/* ---------------------------------------------------------
   ⭐ Reconnect
--------------------------------------------------------- */
function reconnect() {
  if (isReconnecting) return;
  isReconnecting = true;

  clearInterval(heartbeat);
  clearTimeout(reconnectTimer);

  const delay = isIOS ? 1500 : 300;

  reconnectTimer = setTimeout(() => {
    isReconnecting = false;
    setupSocket();
  }, delay);
}

export {
  setupSocket,
  handleBroadcast,
  getMessagesContainer
};
