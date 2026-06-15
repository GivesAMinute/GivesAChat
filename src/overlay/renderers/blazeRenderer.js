import {
  applyExit,
  createAvatar,
  createBaseMessageElement,
  createBubble,
  appendBadgesToBubble,
  appendHtmlTextToBubble
} from "./_shared.js";

export function renderBlazeMessage(msg) {
  if (!msg) return null;

  const username = msg.username || "Unknown";
  const html = msg.html || "";
  const avatar = msg.avatar || null;
  const badges = msg.badges || [];

  const root = createBaseMessageElement();

  const avatarEl = createAvatar(avatar, username);
  if (avatarEl) root.appendChild(avatarEl);

  const bubble = createBubble(username, "blaze");
  appendBadgesToBubble(bubble, badges);
  appendHtmlTextToBubble(bubble, html);

  root.appendChild(bubble);
  applyExit(root);
  return root;
}
