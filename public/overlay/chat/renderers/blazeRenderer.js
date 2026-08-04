import {
  applyExit,
  createBaseMessageElement,
  createBubble,
  appendBadgesToBubble,
  appendHtmlTextToBubble
} from "./_shared.js";

import { colorForUsername } from "../utils/usernameColors.js";

export function renderBlazeMessage(msg) {
  if (!msg) return null;

  // Blaze messages come in msg.data.*
  const data = msg.data || {};

  const username = data.username || "Unknown";
  const html = data.html || "";
  const avatar = data.avatar || null;
  const badges = data.badges || [];

  // Root element
  const root = createBaseMessageElement("blaze");

  // Bubble
  const bubble = createBubble(username, "blaze", avatar);

  // Username colour
  const usernameSpan = bubble.querySelector(".username");
  if (usernameSpan) {
    usernameSpan.style.color = colorForUsername(username, "blaze");
  }

  // Badges
  appendBadgesToBubble(bubble, badges);

  // Message HTML
  appendHtmlTextToBubble(bubble, html);

  root.appendChild(bubble);

  applyExit(root);
  return root;
}
