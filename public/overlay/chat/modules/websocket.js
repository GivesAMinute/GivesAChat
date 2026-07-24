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
   ⭐ BROADCAST HANDLER
--------------------------------------------------------- */
function handleBroadcast(payload) {
  const container = getMessagesContainer();
  if (!container) return;

  if (payload.type === "velora_system") {
    renderVeloraSystemMessage("channel.stream_alert", payload.data, container);
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
   ⭐ WEBSOCKET — with Brave/iOS stability fixes
--------------------------------------------------------- */
let socket = null;
let heartbeat = null;
let reconnectTimer = null;

/* ---------------------------------------------------------
   ⭐ Detect iOS (Safari WebKit)
--------------------------------------------------------- */
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setupSocket() {
  const wsURL = `${location.origin.replace("http", "ws")}/ws/chat`;

  if (socket) {
    try { socket.close(); } catch {}
  }

  /* ---------------------------------------------------------
     ⭐ Brave/iOS Fix #1 — Delay socket creation by 100ms
     Prevents Brave “Wait or Force Reload?”
  --------------------------------------------------------- */
  setTimeout(() => {
    socket = new WebSocket(wsURL);

    socket.addEventListener("open", () => {
      startHeartbeat();
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
   ⭐ Heartbeat — detects dead sockets
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
   ⭐ Reconnect — with iOS safe mode
--------------------------------------------------------- */
function reconnect() {
  clearInterval(heartbeat);
  clearTimeout(reconnectTimer);

  const delay = isIOS ? 1500 : 300;

  reconnectTimer = setTimeout(() => {
    setupSocket();
  }, delay);
}

/* ---------------------------------------------------------
   ⭐ YOUTUBE POLLER — quota‑safe (20s)
--------------------------------------------------------- */
let youtubeBackoffUntil = 0;

async function pollYouTube() {
  try {
    const now = Date.now();
    if (now < youtubeBackoffUntil) return;

    const res = await fetch("/api/youtube/livechat");
    if (!res.ok) return;

    const data = await res.json();

    // If quota exceeded, back off for 60 seconds
    if (data.error && data.error.includes("quota")) {
      youtubeBackoffUntil = now + 60000;
      console.warn("[YouTube] Quota exceeded — backing off for 60s");
      return;
    }

    if (!Array.isArray(data.messages)) return;

    const container = getMessagesContainer();
    if (!container) return;

    data.messages.forEach(msg => {
      handleChat(msg, container);
    });

  } catch (err) {
    console.warn("[YouTube] Poll failed:", err);
  }
}

// Poll every 20 seconds (quota‑safe)
setInterval(pollYouTube, 20000);

export {
  setupSocket,
  handleBroadcast,
  getMessagesContainer
};
