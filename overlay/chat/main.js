import _shared from "../shared/_shared.js";

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

  const icon = document.createElement("img");
  icon.className = "platform-icon";
  icon.src = `/icons/${payload.platform}.png`;

  const avatar = payload.avatar
    ? `<img class="inline-avatar" src="${payload.avatar}">`
    : "";

  const badges = Array.isArray(payload.badges)
    ? payload.badges
        .map((b) => `<img class="badge-icon" src="${b}">`)
        .join("")
    : "";

  el.innerHTML = `
    ${icon.outerHTML}
    <div class="bubble">
      ${avatar}
      <span class="username">${payload.username}</span>
      ${badges}
      <span class="text">${payload.message}</span>
    </div>
  `;

  container.appendChild(el);

  // Ephemeral mode fade-out
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 500);
  }, 45000);
}

function initOverlay() {
  if (!getMessagesContainer()) return;
  setupSocket();
}

document.addEventListener("DOMContentLoaded", initOverlay);
