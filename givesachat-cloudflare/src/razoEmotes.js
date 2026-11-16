// givesachat-cloudflare/src/razoEmotes.js

/* ---------------------------------------------------------
   Razo emotes.

   Every other platform here either sends emotes as structured
   embeds (Beam's own, and the ones Beam relays as
   { type:"emote", url }) or exposes a catalog endpoint we fetch
   and cache (Velora, Blaze, Odysee).

   Razo does neither — yet. Its messages arrive through Beam as
   PLAIN TEXT with the code still in it, so the lane renders a
   literal ":razo_shock:" where the mascot should be. Beam
   presumably has not taught its relay about Razo's emote set,
   which is unsurprising: Razo is new.

   So this does the substitution on our side. The mapping was
   read straight out of Razo's own chat markup rather than
   guessed:

     data-quick-emote=":razo_angry:"
     srcset="/emotes/razo/angry-56.webp 1x,
             /emotes/razo/angry-112.webp 2x"

   The code is the filename with a "razo_" prefix. That is the
   whole rule.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   ⭐ ONE CONSTANT FOR THE HOST, on purpose.

   The srcset above is RELATIVE, so it resolves against whatever
   origin Razo's chat is served from. That looked like razo.tv
   from the page it was inspected on, but an emote set moving to
   a CDN is an ordinary thing to do, and razo.tv's robots.txt
   blocks the fetch that would have confirmed it.

   So the host is unverified, and it is isolated here where a
   correction is one line and no logic changes.
--------------------------------------------------------- */
export const RAZO_EMOTE_BASE = "https://razo.tv";

/* The 2x asset. Razo offers 56 and 112; the lane renders small
   and the overlay is frequently captured at 1080p or better, so
   the larger one is the one that holds up. Size is CSS's job. */
const VARIANT = 112;

/* ---------------------------------------------------------
   ⭐ ANY NAME, NOT A FIXED LIST.

   Razo's picker shows eight mascot emotes today and only two of
   their codes are known for certain (angry, shock) — the rest
   were read off a screenshot of pictures, which is not a source
   of filenames.

   Hardcoding a list of two would render two emotes and leave the
   other six as text, and hardcoding six guessed names would be
   worse: a wrong guess is indistinguishable from a working one
   until it is live.

   So the pattern accepts any plausible name. A code with no
   matching file 404s, and the browser then shows the alt text —
   which is the readable name, i.e. exactly what the lane shows
   TODAY for every Razo emote. The failure mode of a wrong guess
   is therefore the current behaviour, and the upside is that
   all eight work without anyone enumerating them, as do any
   Razo adds later.

   Bounded to keep a pathological string from becoming a src, and
   restricted to the characters a filename can actually use.
--------------------------------------------------------- */
const RAZO_CODE = /:razo_([a-z0-9][a-z0-9_]{0,23}):/gi;

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Replace :razo_name: codes with their images.
 *
 * ⚠️ RUNS ON ALREADY-SANITISED HTML, and must.
 *
 * This inserts <img> tags, so it has to come after sanitising —
 * running it before would mean the sanitiser strips the very
 * markup this just built. The input being sanitised already is
 * what makes that safe, and the name is additionally constrained
 * by the pattern above and escaped below, so nothing a sender
 * types can reach an attribute unescaped.
 *
 * The superchat XSS in this project came in through exactly this
 * shape of code — third-party text going into innerHTML — so the
 * escaping here is deliberate rather than decorative, even though
 * RAZO_CODE already excludes every dangerous character.
 */
export function applyRazoEmotes(html) {
  if (!html || typeof html !== "string") return html;
  if (!html.includes(":")) return html;   // cheap bail: no codes possible

  return html.replace(RAZO_CODE, (whole, name) => {
    const safeName = String(name).toLowerCase();

    /* Belt and braces: the pattern cannot match anything outside
       [a-z0-9_], but a src is not the place to rely on that. */
    if (!/^[a-z0-9_]+$/.test(safeName)) return whole;

    const url = `${RAZO_EMOTE_BASE}/emotes/razo/${safeName}-${VARIANT}.webp`;

    /* alt is what shows if the file is missing, and what TTS
       reads. The underscores are spaces to a reader, so a
       missing emote degrades to "deal with it" rather than
       "razo_dealwithit". */
    const alt = escapeAttr(safeName.replace(/_/g, " "));

    return (
      `<img class="relayed-emote razo-emote" ` +
      `src="${escapeAttr(url)}" alt="${alt}" title="${alt}">`
    );
  });
}
