// givesachat-cloudflare/src/arenaTransform.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   Arena (arena.social / Stars Arena)

   Arena publishes no developer docs, so everything here was
   derived from observed traffic. Two public, unauthenticated
   endpoints do the work:

     /livestreams/public/info?handle=<handle>
       -> livestream.id, isActive, listenersCount

     /live-chat/public/history/livestream/<id>
       -> { messages: [...] }

   Their authenticated Socket.IO endpoint rejects anonymous
   connections, so polling the public history is the only way
   in — which is fine here, and avoids putting an account
   credential anywhere near the worker.

   Being undocumented, these can change without warning. If
   Arena messages stop appearing, check /arena/status first.
--------------------------------------------------------- */

const ARENA_ICON_HOSTS = /^https?:\/\/(static\.starsarena\.com|media\.arena\.social)\//i;

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Only Arena's own CDNs, so a hostile payload can't point us elsewhere. */
function safeArenaImage(url) {
  return typeof url === "string" && ARENA_ICON_HOSTS.test(url) ? url : null;
}

/* ---------------------------------------------------------
   messageData.type varies. Observed:

     text      { message }
     tip       { data: { amount, token: { name, icon }, to } }
     followed  { data: { followedUser } }

   Anything unrecognised is dropped rather than guessed at,
   and logged so it surfaces rather than silently vanishing.
--------------------------------------------------------- */
function renderMessageData(messageData) {
  const type = messageData?.type;

  if (type === "text") {
    return sanitizeHtml(messageData.message || "");
  }

  if (type === "tip") {
    const data = messageData.data || {};
    const amount = Number(data.amount);
    const tokenName = sanitizeHtml(data.token?.name || "");
    const icon = safeArenaImage(data.token?.icon);

    if (!Number.isFinite(amount)) return "";

    // Trim trailing zeros: 1.0486 stays, 0.4900 becomes 0.49
    const pretty = String(Number(amount.toFixed(4)));

    const iconHtml = icon
      ? `<img class="arena-token-icon" src="${escapeAttr(icon)}" alt="">`
      : "";

    return `tipped ${iconHtml}${pretty} ${tokenName}`.trim();
  }

  if (type === "followed") {
    return "followed the stream";
  }

  console.warn("[ARENA] unhandled messageData.type:", type);
  return "";
}

/**
 * @param {object} raw   one entry from the messages array
 * @returns {object|null} overlay chat payload
 */
export function transformArenaMessage(raw) {
  if (!raw || typeof raw !== "object") return null;

  const sender = raw.sender || {};
  const html = renderMessageData(raw.messageData);

  if (!html.trim()) return null;

  const role = String(sender.role || "").toUpperCase();

  return {
    type: "chat",
    platform: "arena",

    messageId: raw.id || null,
    username: sanitizeHtml(sender.name || sender.username || "Unknown"),
    avatar: safeArenaImage(sender.avatar),

    // No Arena badge artwork exists yet. Role is carried through
    // so badges can be added later without touching this file.
    badges: [],
    role,
    isOwner: role === "HOST",

    html,

    timestamp: Number(raw.timestamp) || Date.now()
  };
}

/**
 * Whole history response -> payloads, oldest first.
 * Arena returns messages in ascending time order already, but
 * sorting explicitly means a change on their side can't start
 * rendering chat backwards.
 */
export function transformArenaHistory(json) {
  const messages = Array.isArray(json?.messages) ? json.messages : [];

  return messages
    .slice()
    .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
    .map((m) => ({ id: m.id, payload: transformArenaMessage(m) }))
    .filter((m) => m.id && m.payload);
}
