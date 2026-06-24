// public/overlay/chat/renderers/youtubeRenderer.js
import { colorForUsername } from "../utils/usernameColors.js";
import { sanitizeHTML } from "../utils/sanitizeHTML.js";

export function renderYouTubeMessage(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg youtube-msg";

  const bigAvatar = document.createElement("img");
  bigAvatar.className = "avatar";
  bigAvatar.src = "/icons/youtube.png";
  wrapper.appendChild(bigAvatar);

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const header = document.createElement("div");
  header.className = "header";

  const smallAvatar = document.createElement("img");
  smallAvatar.className = "avatar-small";
  smallAvatar.src = msg.avatar || "/icons/youtube.png";
  header.appendChild(smallAvatar);

  const name = document.createElement("span");
  name.className = "username";
  name.textContent = msg.username;
  name.style.color = colorForUsername(msg.username, "youtube");
  header.appendChild(name);

  bubble.appendChild(header);

  const text = document.createElement("div");
  text.className = "text";
  text.innerHTML = sanitizeHTML(msg.html);

  bubble.appendChild(text);
  wrapper.appendChild(bubble);

  return {
    element: wrapper,
    cleanup() {
      setTimeout(() => {
        bubble.classList.add("fadeOut");
        setTimeout(() => wrapper.remove(), 600);
      }, 45000);
    }
  };
}
