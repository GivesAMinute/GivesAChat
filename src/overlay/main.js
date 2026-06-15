import "../utils/animations.js";
import "../utils/sanitizeHTML.js";
import "../utils/tooltip.js";
import "../utils/usernameColors.js";

import { renderTwitchMessage } from "./renderers/twitchRenderer.js";
import { renderVeloraMessage } from "./renderers/veloraRenderer.js";
import { renderYouTubeMessage } from "./renderers/youtubeRenderer.js";
import { renderBlazeMessage } from "./renderers/blazeRenderer.js";
import { renderBeamMessage } from "./renderers/beamRenderer.js";

const MESSAGES_ID = "messages";
const SOCKET_URL = "wss://headless-chat-browser-production.up.railway.app";

function getMessagesContainer() {
  const el = document.getElementById(MESSAGES_ID);
  if (!el) {
    console.error(`Element #${MESSAGES_ID} not found`);
  }
  return el;
}

function setupSocket() {
  const socket = new WebSocket(SOCKET_URL);

  socket.addEventListener("open", () => {
    console.log("[Overlay] Connected to socket:", SOCKET_URL);
  });

  socket.addEventListener("close", () => {
    console.log("[Overlay] Disconnected from socket");
  });

  socket.addEventListener("error", (err) => {
    console.error("[Overlay] Socket error:", err);
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleBroadcast(payload);
    } catch (err) {
      console.error("[Overlay] Error parsing message:", err);
    }
  });
}

function handleBroadcast(payload) {
  const container = getMessagesContainer();
  if (!container) return;

  if (!payload || !payload.platform) {
    console.warn("[Overlay] Invalid payload:", payload);
    return;
  }

  const platform = String(payload.platform || "").toLowerCase();
  let element = null;

  if (platform === "twitch") {
    element = renderTwitchMessage(payload);
  } else if (platform === "velora") {
    element = renderVeloraMessage(payload);
  } else if (platform === "youtube") {
    element = renderYouTubeMessage(payload);
  } else if (platform === "blaze") {
    element = renderBlazeMessage(payload);
  } else if (platform === "beam") {
    element = renderBeamMessage(payload);
  } else {
    console.warn("[Overlay] Unknown platform:", platform, payload);
    return;
  }

  if (element) {
    container.appendChild(element);
  }
}

function initOverlay() {
  const container = getMessagesContainer();
  if (!container) return;
  setupSocket();
}

document.addEventListener("DOMContentLoaded", initOverlay);
