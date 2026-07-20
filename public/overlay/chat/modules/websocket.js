// public/overlay/chat/modules/websocket.js

import _shared from "/overlay/shared/_shared.js";
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
      console.log("[Chat] Duplicate ignored (1s window):", key);
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

  if (!popupIcon) {
    console.warn("[Popup] No popup icon found for reward:", payload);
    return;
  }

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
   ⭐ BROADCAST HANDLER
--------------------------------------------------------- */
function handleBroadcast(payload) {
  const container = getMessagesContainer();
  if (!container) return;

  if (payload.type === "velora_system") {
    const event = "channel.stream_alert";
    renderVeloraSystemMessage(event, payload.data, container);
    return;
  }

  if (payload.type === "reward" && payload.platform === "velora") {
    handleReward(payload, container);
    showRewardPopup(payload);
    return;
  }

  if (payload.type === "chat") {
    handleChat(payload, container);
    return;
  }

  if (payload.type === "velora_alert") {
    handleVeloraStreamAlert(payload.data);
    return;
  }
}

/* ---------------------------------------------------------
   ⭐ WEBSOCKET — DO‑safe, auto‑reconnect, no keepalive
--------------------------------------------------------- */

let socket = null;
let heartbeat = null;
let backoff = 500;
const maxBackoff = 8000;

function setupSocket() {
  const wsURL = `${location.origin.replace("http", "ws")}/ws/chat`;
  console.log("[Chat] Connecting to WebSocket:", wsURL);

  try {
    if (socket) {
      try { socket.close(); } catch {}
    }
  } catch {}

  socket = new WebSocket(wsURL);

  socket.addEventListener("open", () => {
    console.log("[Chat] WebSocket connected");
    backoff = 500;
    startHeartbeat();
  });

  socket.addEventListener("error", (err) => {
    console.error("[Chat] WebSocket error:", err);
  });

  socket.addEventListener("close", () => {
    console.warn("[Chat] WebSocket closed — reconnecting…");
    reconnect();
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (isDuplicate(payload)) return;

      console.log("[Chat] Incoming:", payload);
      handleBroadcast(payload);

    } catch (err) {
      console.error("[Chat] Error parsing WS message:", err);
    }
  });
}

/* ---------------------------------------------------------
   ⭐ Heartbeat — DO-safe
   - DO sockets: NO keepalive pings
   - Only detect closed sockets and reconnect
--------------------------------------------------------- */
function startHeartbeat() {
  clearInterval(heartbeat);

  heartbeat = setInterval(() => {
    if (!socket) return;

    if (socket.readyState !== WebSocket.OPEN) {
      console.warn("[Chat] Heartbeat detected closed socket");
      reconnect();
    }
  }, 5000);
}

/* ---------------------------------------------------------
   ⭐ Exponential backoff reconnect
--------------------------------------------------------- */
function reconnect() {
  clearInterval(heartbeat);

  const delay = backoff;
  backoff = Math.min(backoff * 1.6, maxBackoff);

  console.warn(`[Chat] Reconnecting in ${delay}ms…`);

  setTimeout(() => {
    setupSocket();
  }, delay);
}

export {
  setupSocket,
  handleBroadcast,
  getMessagesContainer
};
