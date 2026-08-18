// givesachat-cloudflare/src/bitchuteTransform.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { bitchuteSticker, BITCHUTE_STICKER_TOKEN } from "./bitchuteStickers.js";

/* ---------------------------------------------------------
   BitChute chat frames

   BitChute chat is Socket.IO over a raw WebSocket:

     wss://chat001.bitchute.com/socket.io/
       ?cf_auth=<token>&EIO=4&transport=websocket

   A chat message arrives as a socket.io event packet:

     42["message",{
       id, avatar, roomId, owner_id, content,
       timestamp, profile_id, display_name,
       type:"MESSAGE", amount, time
     }]

   Captured from the live pop-out, not guessed.

   TWO THINGS FROM THEIR BUNDLE shaped this file.

   `type` is an enum of exactly MESSAGE and CHATBOMB. A chatbomb
   is BitChute's paid message — the same feature their webhook
   docs describe with an amount and currency — which is why
   `amount` and `time` ride on every frame.

   Stickers are INLINE TOKENS, not a separate event. The sticker
   manifest keys are "[trump-3]" and so on, and they appear in
   `content` alongside ordinary text. So a sticker message is a
   normal message whose content happens to contain a token.
--------------------------------------------------------- */

/* roomId is the CHANNEL id, not the stream. Confirmed against a
   live capture: the pop-out URL carried video Oxf29kKWYoS7 while
   every frame reported roomId x7gWP4Vw8CXN, the channel.

   That is the difference between this and Odysee, where the
   socket is keyed to a per-stream claim that changes every
   broadcast. Here one id in config keeps working. */
const STICKER_CLASS = "bitchute-sticker";

/* Only this host may reach a src. The URL comes from our own
   manifest rather than the wire, but it is checked anyway —
   defence in depth costs one regex. */
const CDN_HOST = /^https:\/\/rant-cdn\.bitchute\.com\//i;

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------------------------------------------------------
   Content -> HTML

   Escaped first, then whole tokens are swapped for images. The
   token pattern only matches [word-digits], so escaping cannot
   create one and user text cannot inject an attribute.

   An unknown token is left as its literal text. BitChute can add
   a sticker set at any time, and showing "[newset-4]" is a
   better failure than a blank gap — it also makes the addition
   visible in the log rather than silent.
--------------------------------------------------------- */
export function renderBitchuteContent(content) {
  const escaped = sanitizeHtml(String(content || ""));

  return escaped.replace(BITCHUTE_STICKER_TOKEN, (token) => {
    const url = bitchuteSticker(token);

    if (!url || !CDN_HOST.test(url)) {
      console.log("[BITCHUTE] unknown sticker token:", token);
      return token;
    }

    return (
      `<img class="${STICKER_CLASS}" src="${escapeAttr(url)}" ` +
      `alt="${escapeAttr(token)}" title="${escapeAttr(token)}">`
    );
  });
}

/* BitChute sends no badge flags at all — no moderator, no
   subscriber, nothing. The only role signal is whether the
   author owns the room, which is derivable by comparing
   profile_id against owner_id. */
function collectBadges(frame) {
  const isOwner =
    frame.profile_id && frame.owner_id && frame.profile_id === frame.owner_id;

  return isOwner ? ["broadcaster"] : [];
}

/**
 * @param {object} frame  the object from 42["message", <frame>]
 * @returns {object|null} overlay chat payload, or null to skip
 */
export function transformBitchuteMessage(frame) {
  if (!frame || typeof frame !== "object") return null;

  /* MESSAGE and CHATBOMB are the only types their client knows.
     Anything else is new, so log it rather than dropping it
     silently — that is how a feature ships and we never notice. */
  const type = String(frame.type || "MESSAGE").toUpperCase();

  if (type !== "MESSAGE" && type !== "CHATBOMB") {
    console.log("[BITCHUTE] unhandled message type:", type.slice(0, 40));
    return null;
  }

  const html = renderBitchuteContent(frame.content);
  if (!html.trim()) return null;

  const isOwner =
    frame.profile_id && frame.owner_id && frame.profile_id === frame.owner_id;

  return {
    type: "chat",
    platform: "bitchute",

    messageId: frame.id || null,
    username: sanitizeHtml(frame.display_name || "Anonymous"),

    /* Anonymous viewers get a server-generated handle and the
       blank-profile image. Both are fine to show as-is. */
    avatar: typeof frame.avatar === "string" ? frame.avatar : null,

    badges: collectBadges(frame),
    isOwner: !!isOwner,

    /* Carried through for a chatbomb card later — nothing
       renders these yet. amount is in the room's currency. */
    ...(type === "CHATBOMB"
      ? { chatbomb: { amount: Number(frame.amount) || 0, seconds: Number(frame.time) || 0 } }
      : {}),

    html,

    // Already milliseconds, unlike Odysee's seconds.
    timestamp: Number(frame.timestamp) || Date.now()
  };
}
