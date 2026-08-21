// givesachat-cloudflare/src/facebookTransform.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   Facebook live comments

   Captured from a real broadcast on the Gives A Minute Page,
   not taken from documentation:

     {
       "id": "1090562013396681_833459173170668",
       "message": "testing a comment",
       "created_time": "2026-08-21T06:13:40+0000",
       "from": {
         "id": "108984299449293",
         "name": "Gives A Minute",
         "picture": { "data": {
           "height": 50, "width": 50,
           "is_silhouette": false,
           "url": "https://scontent-syd2-1.xx.fbcdn.net/..."
         }}
       }
     }

   THE AVATAR IS NESTED TWO DEEP: from.picture.data.url. Reading
   from.picture as a string — which is what most platforms would
   give you, and what the field name suggests — yields "[object
   Object]" in a src attribute and a broken image on every
   message.
--------------------------------------------------------- */

/* Profile pictures come from Facebook's own CDNs. Anything else
   never reaches a src, however plausible it looks — the field is
   third-party data even when the third party is Meta. */
const AVATAR_HOST =
  /^https:\/\/(?:[a-z0-9-]+\.)*(?:fbcdn\.net|fbsbx\.com)\/[^"'<>\s]*$/i;

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------------------------------------------------------
   Avatar

   is_silhouette marks Facebook's default grey placeholder. We
   drop it and let the overlay show its own fallback rather than
   render a generic outline that reads as a broken load.
--------------------------------------------------------- */
/* Shown when Facebook won't say who commented, which is most of
   the time. A neutral silhouette reads as "a viewer"; an empty
   gap reads as "something failed to load", and the bubble sits
   lopsided next to ones that do have a picture. */
export const ANONYMOUS_AVATAR = "/icons/anonymous.svg";

export function facebookAvatar(from) {
  const pic = from?.picture?.data;

  /* is_silhouette marks Facebook's own grey placeholder — no
     more informative than ours, and served from their CDN. */
  if (!pic || pic.is_silhouette) return ANONYMOUS_AVATAR;
  if (typeof pic.url !== "string" || !AVATAR_HOST.test(pic.url)) {
    return ANONYMOUS_AVATAR;
  }

  return pic.url;
}

/* ---------------------------------------------------------
   Timestamps

   ISO 8601 with a +0000 offset, e.g. "2026-08-21T06:13:40+0000".

   Note the offset has NO COLON, which is not valid ISO 8601 and
   which some parsers reject outright. Date.parse in V8 accepts
   it, but the colon is inserted anyway so a parser change can't
   silently start returning NaN — and NaN here would pin every
   message to 1970 at the top of the lane, the same way Odysee's
   seconds-vs-milliseconds bug did.
--------------------------------------------------------- */
export function facebookTimestamp(created) {
  if (typeof created !== "string") return Date.now();

  const normalised = created.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalised);

  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * @param {object} comment  one entry from live_comments / comments.data
 * @param {object} page     { id, name } the Page being read
 * @returns {object|null}   overlay chat payload, or null to skip
 */
export function transformFacebookComment(comment, page = {}) {
  if (!comment || typeof comment !== "object") return null;

  const message = typeof comment.message === "string" ? comment.message : "";

  /* Comments can be attachment-only — a sticker or a GIF with no
     text. Nothing to render, and an empty bubble is worse than
     no bubble. */
  if (!message.trim()) return null;

  const from = comment.from || null;

  /* ---------------------------------------------------------
     `from` is USUALLY ABSENT, and that is normal.

     Confirmed against a real viewer comment — the entire object
     is missing, not empty:

       {"id":"…","message":"Testing a chat message",
        "created_time":"2026-08-21T07:56:56+0000"}

     Meta scopes user identity per app: someone who has never
     authorised THIS app cannot be identified through it, and
     pages_read_user_content grants the content, not the person.
     The Page's own comments do carry `from`, because the Page
     is not a third party to itself.

     So most viewers arrive anonymous. Nothing to fix — the
     comment is still real and still worth showing.
  --------------------------------------------------------- */
  const displayName = from?.name || "Facebook viewer";

  /* The Page commenting on its own broadcast is the streamer.
     Same derivation as BitChute — no badge flags exist, but the
     author id compared against the room owner id answers it. */
  const isOwner = !!(from?.id && page.id && from.id === page.id);

  return {
    type: "chat",
    platform: "facebook",

    messageId: comment.id || null,
    username: sanitizeHtml(displayName),
    avatar: facebookAvatar(from),

    badges: isOwner ? ["broadcaster"] : [],
    isOwner,

    /* Which Page this came from. Nothing renders it today, but
       two Pages could be live at once and a message with no
       origin would be impossible to place after the fact. */
    sourceId: page.id || null,
    sourceName: page.name || null,

    html: sanitizeHtml(message),

    timestamp: facebookTimestamp(comment.created_time)
  };
}
