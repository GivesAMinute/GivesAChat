import {
  applyExit,
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

  // ⭐ Platform icon only — no avatar here
  const root = createBaseMessageElement("blaze");

  // ⭐ Avatar now lives INSIDE the bubble
  const bubble = createBubble(username, "blaze", avatar);

  // Blaze badges (OG, VIP, Mod, Streamer) come through msg.badges
  appendBadgesToBubble(bubble, badges);

  // Message HTML
  appendHtmlTextToBubble(bubble, html);

  root.appendChild(bubble);

  applyExit(root);
  return root;
}
