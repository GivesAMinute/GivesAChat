import {
  applyExit,
  createBaseMessageElement,
  createBubble,
  appendBadgesToBubble,
  appendHtmlTextToBubble
} from "./_shared.js";

// Corrected import for public/overlay/chat/utils
import { colorForUsername } from "../utils/usernameColors.js";

export function renderBlazeMessage(msg) {
  if (!msg) return null;

  const username = msg.username || "Unknown";
  const html = msg.html || "";
  const avatar = msg.avatar || null;
  const badges = msg.badges || [];

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
