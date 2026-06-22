import _shared from "../shared/_shared.js";
import { renderBlazeBadges } from "./badges/blaze/index.js";
import { colorForUsername } from "../../src/utils/usernameColors.js";   // ⭐ VERIFIED CORRECT PATH

const MESSAGES_ID = "messages";

function getMessagesContainer() {
  return document.getElementById(MESSAGES_ID);
}

function setupSocket() {
  const socket = new WebSocket(_shared.wsURL);

  socket.addEventListener("open", () => {
    console.log("[Overlay] Connected to socket:", _shared.wsURL);
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

  if (!payload || payload.type !== "chat") return;

  const el = document.createElement("div");
  el.className = "chat-message";

  // Platform icon
  const icon = document.createElement("img");
  icon.className = "platform-icon";
  icon.src = `/icons/${payload.platform}.png`;

  // Inline avatar
  const avatar = payload.avatar
    ? `<img class="inline-avatar" src="${payload.avatar}">`
    : "";

  // Blaze badges
  const badgesHTML = renderBlazeBadges(payload);

  // Build bubble
  el.innerHTML = `
    ${icon.outerHTML}
    <div class="bubble">
      ${avatar}
      ${badgesHTML}
      <span class="username">${payload.username}</span>
      <span class="text">${payload.html}</span>
    </div>
  `;

  // ⭐ APPLY USERNAME COLOUR — CORRECT ARG ORDER
  const usernameSpan = el.querySelector(".username");
  if (usernameSpan) {
    const color = colorForUsername(payload.username, payload.platform);
    usernameSpan.style.color = color;
  }

  container.appendChild(el);

  // Fade-out after 45 seconds
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 600);
  }, 45000);
}

function initOverlay() {
  if (!getMessagesContainer()) return;
  setupSocket();
}

document.addEventListener("DOMContentLoaded", initOverlay);
