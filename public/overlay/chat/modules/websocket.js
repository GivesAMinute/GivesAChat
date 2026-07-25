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
   ⭐ BROADCAST HANDLER (Velora only)
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
   ⭐ BEAMSTREAM CHAT — Engine.IO / Socket.IO client
--------------------------------------------------------- */

const BEAM_WS_URL =
  "wss://beamstream.gg/api/chat/api/v1/socket/?EIO=4&transport=websocket";

let beamSocket = null;

function startBeamstreamChat() {
  try {
    beamSocket = new WebSocket(BEAM_WS_URL);

    beamSocket.addEventListener("open", () => {
      console.log("[Beamstream] Connected");
    });

    beamSocket.addEventListener("close", () => {
      console.log("[Beamstream] Closed — reconnecting...");
      setTimeout(startBeamstreamChat, 3000);
    });

    beamSocket.addEventListener("error", (err) => {
      console.warn("[Beamstream] Error:", err);
    });

    beamSocket.addEventListener("message", (event) => {
      const raw = event.data;

      // Engine.IO / Socket.IO framing:
      if (typeof raw !== "string") return;
      if (!raw.startsWith("42")) return;

      let arr;
      try {
        arr = JSON.parse(raw.slice(2));
      } catch {
        return;
      }

      const eventName = arr[0];
      const payload = arr[1];
      if (!payload) return;

      const mapped = mapBeamstreamToOverlay(payload);
      if (!mapped) return;

      // ⭐ HARD FILTER — DO NOT ALLOW VELORA FROM BEAMSTREAM
      const p = mapped.platform?.toLowerCase();
      if (
        p === "velora" ||
        p === "velora.tv" ||
        p === "vlr" ||
        p === "vel" ||
        p === "v" ||
        p?.includes("velora")
      ) {
        return;
      }

      const container = getMessagesContainer();
      if (!container) return;

      handleChat(mapped, container);
    });
  } catch (err) {
    console.warn("[Beamstream] Failed to connect:", err);
  }
}

/* ---------------------------------------------------------
   ⭐ Beamstream → Overlay mapper
   Adjust once you inspect real Beamstream payloads.
--------------------------------------------------------- */
function mapBeamstreamToOverlay(payload) {
  const username =
    payload.username ||
    payload.user?.name ||
    payload.author?.displayName;

  const message =
    payload.message ||
    payload.text ||
    payload.content;

  if (!username || !message) return null;

  // Beamstream platform detection
  const platform =
    payload.platform ||
    payload.service ||
    payload.source ||
    payload.channelType ||
    "beamstream";

  return {
    type: "chat",
    platform,
    data: {
      username,
      message,
      badges: payload.badges || [],
      emotes: payload.emotes || []
    }
  };
}

/* ---------------------------------------------------------
   ⭐ MAIN OVERLAY WEBSOCKET (Velora)
--------------------------------------------------------- */
let socket = null;
let heartbeat = null;
let reconnectTimer = null;

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setupSocket() {
  const wsURL = `${location.origin.replace("http", "ws")}/ws/chat`;

  if (socket) {
    try { socket.close(); } catch {}
  }

  setTimeout(() => {
    socket = new WebSocket(wsURL);

    socket.addEventListener("open", () => {
      startHeartbeat();

      // ⭐ Start Beamstream chat once overlay WS is ready
      startBeamstreamChat();
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

export {
  setupSocket,
  handleBroadcast,
  getMessagesContainer
};
