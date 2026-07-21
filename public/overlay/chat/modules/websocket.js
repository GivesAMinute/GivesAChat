// public/overlay/chat/modules/websocket.js

import _shared from "/overlay/shared/_shared.js";
import { handleReward } from "./rewardRenderer.js";
import { handleChat, renderVeloraSystemMessage } from "./chatRenderer.js";
import { handleVeloraStreamAlert } from "./alertRenderer.js";

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

function getMessagesContainer() {
  return document.getElementById("messages");
}

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

let socket = null;
let heartbeat = null;

function setupSocket() {
  const wsURL = `${location.origin.replace("http", "ws")}/ws/chat`;

  if (socket) {
    try { socket.close(); } catch {}
  }

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
}

function startHeartbeat() {
  clearInterval(heartbeat);

  heartbeat = setInterval(() => {
    if (!socket) return;
    if (socket.readyState !== WebSocket.OPEN) {
      reconnect();
    }
  }, 3000);
}

function reconnect() {
  clearInterval(heartbeat);
  setTimeout(() => {
    setupSocket();
  }, 300);
}

export {
  setupSocket,
  handleBroadcast,
  getMessagesContainer
};
