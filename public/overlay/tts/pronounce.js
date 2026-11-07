// public/overlay/tts/pronounce.js

/* ---------------------------------------------------------
   Make the voice say things the way people say them.

   Three problems, one place to fix them, because every spoken
   string in the overlay goes through speakText():

     ELFSAR   was read "E-L-F-S-A-R"
     VPZONE   came out closer to "VipZone"
     Koebsch  was anybody's guess

   ⚠️ SPEECH ONLY. Nothing here touches what is on screen. The
   name in the chat bubble stays exactly as the viewer typed it;
   this rewrites the separate string handed to the speech engine.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   Say-it-like-this. Add a line when something comes out wrong.

   Matched case-insensitively and on word boundaries, so
   "vpzone", "VPZONE" and "VpZone" all land, while a username
   like "vpzoner" is left alone.

   Written as a list rather than an object because order matters
   once entries overlap: the longest, most specific phrase has
   to be substituted before a shorter one inside it.
--------------------------------------------------------- */
const PRONUNCIATIONS = [
  // Platform names
  [/\bvp\s*-?\s*zone\b/gi, "Vee Pee Zone"],

  // People
  [/\bkoebsch\b/gi, "Kerbsh"],

  /* Viewers whose names the engine cannot be expected to guess.
     Run-together words and invented spellings both land here —
     no rule distinguishes "melbournedoug" from a surname, and
     "Ph" is only an F when a human decides it is. */
  [/\bmelbournedoug\b/gi, "Mel Born Doug"],
  [/\bphlomix\b/gi, "Flow Mix"]
];

/* ---------------------------------------------------------
   Initialisms that are MEANT to be spelled out.

   De-shouting below turns an all-caps word into a normal one so
   the engine reads it as a word rather than a letter at a time.
   That is right for ELFSAR and wrong for OBS, which should stay
   "O-B-S" rather than becoming "obbs".

   Only entries that genuinely sound wrong as a word belong
   here. LOL is deliberately absent, because "lol" is how people
   say it. OMG is present, because they say "O-M-G" rather than
   rhyming it with "wrong".
--------------------------------------------------------- */
const KEEP_SPELLED = new Set([
  "OBS", "TTS", "URL", "API", "CPU", "GPU", "FPS", "RTMP",
  "PC", "TV", "DM", "DMS", "ID", "HD", "AI", "PS", "UK", "USA",
  "AU", "NSW", "IRL", "AFK", "FAQ", "IMO", "FYI", "ETA", "DIY",
  "OMG"
]);

/* A run of capitals with no vowel in it cannot be said as a
   word — GG, BRB, WTF. Leave those spelled; the engine already
   does the sensible thing. */
const HAS_VOWEL = /[AEIOUY]/;

/* ---------------------------------------------------------
   A run of capitals that is a WHOLE word, not a fragment.

   The leading group is the critical part. Without it the
   pattern matched the "AM" inside GivesAMinute and said
   "GivesAminute" — it has to be capitals with no letter on
   either side, so a CamelCase name is left alone.

   Written with a captured preceding character rather than a
   lookbehind, which older iOS Safari does not support and this
   runs on an iPad.

   Not \w either: that would swallow the underscore in
   MELLOW_D and make it "Mellow_d" instead of "Mellow_D".
--------------------------------------------------------- */
const TOKEN = /(^|[^A-Za-z])([A-Z][A-Z0-9'’]*)(?![A-Za-z])/g;

/**
 * ELFSAR -> Elfsar, so the engine says it instead of spelling it.
 *
 * Only touches tokens that are entirely upper case. A name
 * already written "Elfsar" or "McDonald" is left exactly as it
 * is — this fixes shouting, it does not normalise casing.
 */
export function deShout(text) {
  if (typeof text !== "string" || !text) return text;

  return text.replace(TOKEN, (match, before, token) => {
    const letters = token.replace(/[^A-Z]/g, "");

    if (letters.length < 2) return match;            // "I", "A"
    if (KEEP_SPELLED.has(letters)) return match;
    if (!HAS_VOWEL.test(letters)) return match;      // GG, BRB

    return before + token.charAt(0) + token.slice(1).toLowerCase();
  });
}

/**
 * The full pass: dictionary first, then de-shouting.
 *
 * Dictionary first on purpose. "VPZONE" is itself all caps, and
 * de-shouting it to "Vpzone" would still match the
 * case-insensitive rule below — but a future entry written in
 * caps would not, and getting the order right once is cheaper
 * than remembering the rule every time a line is added.
 *
 * @param {string} text  what the engine is about to say
 * @returns {string}     the same thing, said properly
 */
export function pronounce(text) {
  if (typeof text !== "string" || !text) return text;

  let out = text;
  for (const [pattern, replacement] of PRONUNCIATIONS) {
    out = out.replace(pattern, replacement);
  }

  return deShout(out);
}
