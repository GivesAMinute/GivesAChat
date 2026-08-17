// givesachat-cloudflare/src/odyseeTransform.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   Odysee chat frames

   Odysee has no chat API. Chat is Commentron — their general
   comment system — with live updates pushed over a pub/sub
   relay they call Sockety:

     wss://sockety.odysee.tv/ws/commentron
       ?id=<stream claim id>
       &category=<@channel:short>
       &sub_category=commenter

   Frames were captured from a live pop-out rather than read
   from a spec, because no spec exists. One real frame:

     {"type":"delta","data":{"comment":{
       "channel_id":"2e4c63a3...","channel_name":"@GivesAMinute",
       "channel_url":"lbry://@GivesAMinute#2e4c63a3...",
       "claim_id":"d9f729d3...","comment":"tester message",
       "comment_id":"3012e134...","currency":"","is_creator":true,
       "is_fiat":false,"is_hidden":false,"is_pinned":false,
       "is_protected":false,"signature":"...","signing_ts":"1786939103",
       "support_amount":0,"timestamp":1786939103}}}

   Three things about that shape drive the code below.

   TIMESTAMPS ARE SECONDS. Every other platform we carry sends
   milliseconds. 1786939103 read as ms is January 1970, which
   would sort every Odysee message to the top of the lane
   forever. It has to be multiplied by 1000.

   COMMENT IS PLAIN TEXT. No markup, no delta, no emote map —
   so it must be escaped before it reaches innerHTML.

   NO AVATAR. Nothing in the frame identifies a picture.
   OdyseeRoom resolves one from channel_url separately.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   Emotes

   Odysee emotes arrive as bare :tokens: in the comment text —
   there is no emote map on the frame. Their own client renders

     :cowboy_hat_face:
       -> static.odycdn.com/emoticons/twemoji/smilies/
            cowboy_hat_face.png

   so the URL is built from the token directly. No lookup, no
   catalogue to maintain.

   "smilies" IS A CATEGORY, and it cannot be guessed. Probing
   the CDN for the same name across every candidate settled it:

     cowboy_hat_face   200 under smilies      (403 elsewhere)
     rocket            200 under activities   (403 elsewhere)

   with a deliberately fake name returning 403 everywhere, so
   those 200s are real.

   Note WHERE rocket landed. Twemoji's own grouping files
   rockets under "travel & places"; Odysee put it in
   "activities". So the category cannot be derived from the
   emote name, from twemoji convention, or from anything else
   in the message — it is Odysee's own arrangement and the only
   authority on it is the CDN.

   So OdyseeRoom resolves each name against the CDN once and
   caches the answer, and passes the map in here. That is
   deliberately preferred over a hardcoded name -> category
   table: a table would be wrong the day Odysee adds an emote,
   and wrong silently.

   Any name with no known category is left as its literal
   :token: text — readable, and honest about what we don't
   know. Nothing is ever guessed into a src attribute.

   The name is matched strictly. It goes straight into a src.

   THE BOUNDARY GUARD IS NOT OPTIONAL. Without it, "the stream
   starts at 10:30:00" contains ":30:" and renders a broken
   emote in the middle of a time. Requiring a non-word
   character before the opening colon fixes clock times, score
   lines and ratios in one go, while still allowing emotes to
   sit flush against each other — ":rocket::fire:" — because a
   colon is not a word character.
--------------------------------------------------------- */
export const EMOTE_TOKEN = /(?<!\w):([a-z0-9_+-]{2,40}):(?!\w)/gi;

const EMOTE_CDN = "https://static.odycdn.com/emoticons/twemoji/";

/* Case is PRESERVED, not folded. Odysee custom emotes are
   uppercase — ":PISS:" is a real one — and a CDN path is
   case-sensitive, so lowercasing the name would request a file
   that does not exist. Twemoji names happen to be lowercase
   already, so nothing is lost by leaving case alone. */
const SAFE_NAME = /^[A-Za-z0-9_+-]{2,40}$/;
const SAFE_CATEGORY = /^[a-z]{2,20}$/;

export function odyseeEmoteUrl(name, category) {
  return `${EMOTE_CDN}${category}/${name}.png`;
}

/**
 * Every distinct emote name in a message, lowercased.
 * OdyseeRoom uses this to resolve categories before rendering.
 */
export function findEmoteNames(text) {
  const names = new Set();

  for (const [, name] of String(text || "").matchAll(EMOTE_TOKEN)) {
    if (SAFE_NAME.test(name)) names.add(name);
  }

  return [...names];
}

/**
 * @param {string} escapedText   already through sanitizeHtml
 * @param {Map|object} categories  name -> category, or name -> null
 */
function renderOdyseeEmotes(escapedText, categories) {
  if (!categories) return escapedText;

  const lookup = (name) =>
    categories instanceof Map ? categories.get(name) : categories[name];

  return escapedText.replace(EMOTE_TOKEN, (token, name) => {
    const file = name;
    const category = lookup(file);

    /* No category resolved — the CDN had no such emote in any
       of them. Leave the literal :token: rather than emitting a
       src we know will 404. */
    if (!category) return token;

    /* Both halves are re-checked even though they came from a
       constrained pattern and our own probe list. They are
       about to be concatenated into a URL and an attribute. */
    if (!SAFE_NAME.test(file) || !SAFE_CATEGORY.test(category)) return token;

    return (
      `<img class="odysee-emote" src="${odyseeEmoteUrl(file, category)}" ` +
      `alt=":${file}:" title=":${file}:">`
    );
  });
}

/* ---------------------------------------------------------
   Badge flags.

   Commentron is a comment system, so it carries far less
   author metadata than a purpose-built chat API — there is no
   moderator, subscriber or founder flag on the wire at all.
   Only these three exist, and there is no Odysee badge artwork
   in the repo yet. Flags are carried on the payload so badges
   can be added later without touching this file.
--------------------------------------------------------- */
const BADGE_FLAGS = [
  ["is_creator", "broadcaster"],
  ["is_pinned", "pinned"],
  ["is_protected", "protected"]
];

function collectBadges(comment) {
  return BADGE_FLAGS
    .filter(([field]) => comment[field] === true)
    .map(([, name]) => name);
}

/* ---------------------------------------------------------
   Tips.

   A comment with support_amount > 0 is Odysee's hyperchat. The
   amount is LBC unless is_fiat is set, in which case currency
   holds the code. Rendered as a prefix rather than a separate
   event type so it flows through the ordinary bubble.
--------------------------------------------------------- */
function tipPrefix(comment) {
  const amount = Number(comment.support_amount) || 0;
  if (amount <= 0) return "";

  const unit = comment.is_fiat
    ? sanitizeHtml(String(comment.currency || "USD").slice(0, 8))
    : "LBC";

  return `<span class="odysee-tip">${amount} ${unit}</span> `;
}

/**
 * Strips the leading @ from a channel name for display.
 * Odysee sends "@GivesAMinute"; every other platform in the
 * lane sends a bare name, and the icon already says Odysee.
 *
 * The fallback is applied AFTER sanitising, not before. A name
 * made entirely of markup — "@<svg onload=...>" — is non-empty
 * going in and empty coming out, so checking first yields a
 * nameless bubble on stream.
 */
function displayName(channelName) {
  const stripped = String(channelName || "").replace(/^@/, "").trim();
  return sanitizeHtml(stripped).trim() || "Anonymous";
}

/**
 * @param {object} frame  a raw sockety frame, already parsed
 * @returns {object|null} overlay chat payload, or null to skip
 */
export function transformOdyseeFrame(frame, emoteCategories = null) {
  if (!frame || typeof frame !== "object") return null;

  /* Sockety multiplexes more than new comments — edits,
     removals and pins all travel the same socket. Only
     "delta" has been observed carrying a new comment; anything
     else is logged so the shape becomes visible in
     `wrangler tail` rather than being silently swallowed. */
  if (frame.type !== "delta") {
    console.log("[ODYSEE] non-delta frame type:", String(frame.type).slice(0, 40));
    return null;
  }

  const comment = frame.data?.comment;
  if (!comment || typeof comment !== "object") return null;

  /* Hidden means moderated away. Sockety still relays the
     frame; rendering it would put a comment on stream that
     Odysee's own chat has already removed. */
  if (comment.is_hidden === true) return null;

  const text = String(comment.comment || "");

  const html =
    tipPrefix(comment) +
    renderOdyseeEmotes(sanitizeHtml(text), emoteCategories);
  if (!html.trim()) return null;

  /* Seconds -> milliseconds. See the note at the top. */
  const seconds = Number(comment.timestamp) || 0;

  return {
    type: "chat",
    platform: "odysee",

    messageId: comment.comment_id || null,
    username: displayName(comment.channel_name),
    avatar: null,             // filled in by OdyseeRoom
    badges: collectBadges(comment),

    isOwner: comment.is_creator === true,

    /* Kept so OdyseeRoom can resolve the channel thumbnail.
       channel_id is the cache key; channel_url is the input to
       the resolve call. */
    channelId: typeof comment.channel_id === "string" ? comment.channel_id : null,
    channelUrl: typeof comment.channel_url === "string" ? comment.channel_url : null,

    html,

    timestamp: seconds > 0 ? seconds * 1000 : Date.now()
  };
}

/* ---------------------------------------------------------
   Thumbnails

   Odysee channel thumbnails are author-supplied, so the raw
   URL can point at any host on the internet — it goes straight
   into a src attribute, which makes it a real injection
   surface, not a theoretical one.

   Routing every thumbnail through Odysee's own image optimiser
   fixes that: the host in the DOM is always odycdn, whatever
   the author set. It also resizes, so we aren't pulling a
   multi-megabyte original for a 32px avatar.
--------------------------------------------------------- */
const THUMB_OPTIMIZER = "https://thumbnails.odycdn.com/optimize/s:160:160/quality:85/plain/";

export function safeOdyseeThumbnail(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  if (url.length > 1000) return null;

  // Already optimised — Odysee sometimes stores it that way.
  if (url.startsWith(THUMB_OPTIMIZER)) return url;

  return THUMB_OPTIMIZER + encodeURIComponent(url);
}
