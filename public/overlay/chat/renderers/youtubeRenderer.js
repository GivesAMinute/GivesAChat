// public/overlay/chat/renderers/youtubeRenderer.js

export function renderYouTubeMessage(event) {
  const container = document.createElement("div");
  container.className = "chat-line youtube";

  const icon = document.createElement("img");
  icon.className = "platform-icon";
  icon.src = "/icons/youtube.png";
  icon.alt = "YouTube";

  const user = document.createElement("span");
  user.className = "chat-username";
  user.textContent = event.user?.name || "Unknown";

  const message = document.createElement("span");
  message.className = "chat-message";
  message.textContent = event.message || "";

  container.appendChild(icon);
  container.appendChild(user);
  container.appendChild(message);

  return container;
}
