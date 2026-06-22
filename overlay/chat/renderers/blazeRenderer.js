import {
  applyExit,
  createBaseMessageElement,
  createBubble,
  appendBadgesToBubble,
  appendHtmlTextToBubble
} from "./_shared.js";

import { colorForUsername } from "../../../src/utils/usernameColors.js";

export function renderBlazeMessage(msg) {
  if (!msg) return null;

  const username = msg.username || "Unknown";
  const html = msg.html || "";
  const avatar = msg.avatar || null;
  const badges = msg.badges || [];

  // ⭐ Platform icon only — no avatar here
  const root = createBaseMessageElement("blaze");

  // ⭐ Avatar + username + badges live INSIDE the bubble
  const bubble = createBubble(username, "blaze", avatar);

  // ⭐ Apply username color (per‑session, weighted palette)
  const usernameSpan = bubble.querySelector(".username");
  if (usernameSpan) {
    usernameSpan.style.color = colorForUsername(username, "blaze");
  }

  // Blaze badges (OG, VIP, Mod, Streamer)
  appendBadgesToBubble(bubble, badges);

  // Message HTML
  appendHtmlTextToBubble(bubble, html);

  root.appendChild(bubble);

  applyExit(root);
  return root;
}
