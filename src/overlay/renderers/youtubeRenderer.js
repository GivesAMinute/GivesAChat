import {
  applyExit,
  createAvatar,
  createBaseMessageElement,
  createBubble,
  appendHtmlTextToBubble
} from "./_shared.js";

export function renderYouTubeMessage(msg) {
  if (!msg) return null;

  const username = msg.username || "Unknown";
  const html = msg.html || "";
  const avatar = msg.avatar || null;

  const root = createBaseMessageElement();

  const avatarEl = createAvatar(avatar, username);
  if (avatarEl) root.appendChild(avatarEl);

  const bubble = createBubble(username, "youtube");
  appendHtmlTextToBubble(bubble, html);

  root.appendChild(bubble);
  applyExit(root);
  return root;
}
