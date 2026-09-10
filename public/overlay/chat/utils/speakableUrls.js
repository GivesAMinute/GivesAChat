// public/overlay/chat/utils/speakableUrls.js

/* ---------------------------------------------------------
   Make URLs bearable to listen to.

   A viewer posting a map link meant the TTS voice read this out
   in full, coordinate by coordinate:

     https://www.windy.com/-Rain-thunder-rain?rain,-29.329,153.293,12,p:cams

   which is about twenty seconds of digits and takes the whole
   chat queue with it, since speech is serialised.

   Spoken instead:

     link to windy.com, Rain thunder rain

   ⚠️ THIS AFFECTS SPEECH ONLY.

   The rendered message is untouched — linkify() runs on the DOM
   after the sanitised HTML is in place, and this runs on a
   separate string built for the speech queue. The link on screen
   stays exactly as posted and stays clickable. Nothing here ever
   reaches innerHTML.
--------------------------------------------------------- */

/* Same pattern linkify() uses, deliberately: if the two disagreed
   about what a URL is, a viewer could post something that renders
   as a link but is read aloud in full, or the reverse. */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/* Trailing punctuation belongs to the sentence, not the URL —
   "see https://x.com/foo." — matching linkify's own trimming. */
const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;

/* ---------------------------------------------------------
   Is a path segment worth saying out loud?

   "-Rain-thunder-rain"  -> yes, it is words
   "dQw4w9WgXcQ"         -> no, it is a video id
   "12"                  -> no
   "p:cams"              -> no

   The test is whether the segment reads like language: enough
   letters, not mostly digits, and not one long unbroken mixed-case
   token, which is what ids and hashes look like.
--------------------------------------------------------- */
function isWordy(segment) {
  const letters = (segment.match(/[a-z]/gi) || []).length;
  const digits = (segment.match(/[0-9]/gi) || []).length;

  if (letters < 3) return false;
  if (digits > letters) return false;

  const words = segment.split(/[-_+.]+/).filter(Boolean);

  /* A single unbroken token with digits in it, of any real
     length, is an id rather than a phrase — "dQw4w9WgXcQ" is
     eleven characters and says nothing. Multi-word segments get
     the benefit of the doubt, because that is exactly what a
     human-readable slug looks like. */
  if (words.length === 1 && digits > 0 && segment.length >= 8) return false;

  return true;
}

/* ---------------------------------------------------------
   Path segments that are routing, not meaning.

   youtube.com/watch?v=… is "link to youtube.com, watch", which
   is worse than saying nothing extra: the actual title is in the
   query string we deliberately drop. Same for /wiki/ and /p/.

   Kept deliberately short. Anything not on this list is assumed
   to carry meaning, because guessing wrong in that direction
   only costs a word or two.
--------------------------------------------------------- */
const NOISE = new Set([
  "watch", "wiki", "index", "view", "page", "post", "posts",
  "status", "video", "videos", "p", "e", "s", "r", "www"
]);

function tidy(segment) {
  return segment
    .replace(/\.(html?|php|aspx?|jsp)$/i, "")   // drop file extensions
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One URL as a short spoken phrase.
 *
 * Query strings and fragments are dropped entirely — that is
 * where the coordinates, tracking ids and session tokens live,
 * and none of it is worth hearing.
 */
export function describeUrl(raw) {
  let url;

  try {
    url = new URL(raw);
  } catch {
    return "a link";
  }

  const host = url.hostname.replace(/^www\./i, "");

  const words = decodeURIComponent(url.pathname)
    .split("/")
    .filter(Boolean)
    .filter(isWordy)
    .filter((seg) => !NOISE.has(seg.toLowerCase()))
    .slice(0, 2)
    .map(tidy)
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .slice(0, 6)          // a summary, not a recital
    .join(" ");

  return words ? `link to ${host}, ${words}` : `link to ${host}`;
}

/**
 * Replace every URL in a string with its spoken form.
 *
 * @param {string} text  the message as it would have been spoken
 * @returns {string}     the same text, links summarised
 */
export function speakableUrls(text) {
  if (typeof text !== "string" || !text) return text;

  URL_RE.lastIndex = 0;

  return text.replace(URL_RE, (match) => {
    const trailing = (match.match(TRAILING_PUNCT) || [""])[0];
    const clean = trailing ? match.slice(0, -trailing.length) : match;

    return describeUrl(clean) + trailing;
  });
}
