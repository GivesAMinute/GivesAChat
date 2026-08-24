// givesachat-cloudflare/src/rewardPlan.js

/* ---------------------------------------------------------
   Velora ^command naming.

   Velora resolves ^commands natively and the trigger is the
   reward NAME with spaces stripped, matched case-insensitively.
   There is no slug field, so the name is the ONLY lever on how
   long a command is:

     "What A Beautiful Group Of People"
       -> ^whatabeautifulgroupofpeople   (28 characters)

   which is slower to type than searching the rewards list, and
   therefore pointless.

   THIS IS A PURE FUNCTION, ON PURPOSE. The preview and the apply
   must agree exactly on every one of 163 names. Two copies of
   this logic would drift the first time either was touched, and
   the symptom would be a preview that does not match what was
   written to a live channel.
--------------------------------------------------------- */

export const DEFAULT_MAX = 14;

/* Hand-picked, because the scorer optimises for distinctiveness
   and length and has no idea what a viewer would reach for.
   Keyed on the exact current name; these bypass the scorer and
   claim their triggers before anything is generated. */
export const OVERRIDES = new Map(Object.entries({
  "Purrrrrrrrrrrfect": "Purrfect",          // nobody can count the r's
  "Precipipitation": "Precip",              // 15 chars; joke lives in the description
  "I'm Not Like Some Madman": "Madman",     // base owns the plain word
  "I'm Not Like Some Madman (Full)": "Madman Full",
  "Grab Your Baby": "Baby",
  "Grab Your Baby (Full)": "Baby Full",
  "I Wrote That Script": "Tribbles",        // stops the two Scripts fighting
  "USA National Anthem": "USA Anthem",      // the three were inconsistent
  "CA National Anthem": "CA Anthem",
  "AU National Anthem": "AU Anthem",
  "I Don't Know What's Gonna Work": "Gonna Work",  // "Whats" means nothing
  "The Dark Heart of EV's": "Dark Heart",   // ^heart reads as Richard Heart
  "I Did Not Hit Her (Full)": "Did Not Hit"
}));

/* Words carrying no identity. Applied as a score penalty rather
   than a filter, so a name made entirely of them still yields a
   candidate instead of falling through to nothing. */
const STOP = new Set(
  ("a an the of is it its to and i you we they he she that this my me be in on for with was are all at but do so " +
   "not no yes very just really gonna wanna some out up im dont thats what when why how who if as by from or am " +
   "been being have has had will would could should can cant there here then than too also about into over under " +
   "again more most much many get got go going gone like one us him her them their our your his ok okay know now " +
   "say said see").split(" ")
);

export const clean = (n) =>
  String(n || "").replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export const trigger = (n) => clean(n).replace(/ /g, "");

const flat = (x) => clean(x).toLowerCase();

function speakerOf(description) {
  const m = String(description || "")
    .match(/Plays\s+(?:the\s+)?([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)?)/);
  return m ? m[1].replace(/\s+/g, "") : "";
}

/**
 * @param {Array} list   rewards as Velora returns them
 * @param {object} opts  { max }
 * @returns {{rows:Array, clashes:Array}}
 */
export function buildRewardPlan(list, { max = DEFAULT_MAX } = {}) {
  const rows = list.map((r) => {
    const name = String(r?.name || "");
    const description = String(r?.description || "");
    const cleaned = clean(name);

    return {
      id: r?.id ?? null,
      name,
      description,
      cleaned,
      speaker: speakerOf(description),
      len: trigger(name).length,
      punct: cleaned !== name.replace(/\s+/g, " ").trim(),

      /* Shortening "What A Beautiful Group Of People" to
         "Beautiful" is free only because the description already
         reads: Plays Trump saying "What A Beautiful Group Of
         People" — the phrase survives elsewhere. Where it does
         not, the wording is destroyed and nothing on the channel
         records it again. Compared with punctuation and case
         stripped from both sides so quoting style cannot cause a
         false miss. */
      phraseSafe: flat(description).includes(flat(name)),

      proposed: null,
      manual: false
    };
  });

  /* How many rewards use each word. A word shared with five
     others is a poor handle for any of them. */
  const df = new Map();
  for (const r of rows) {
    for (const w of new Set(r.cleaned.toLowerCase().split(" ").filter(Boolean))) {
      df.set(w, (df.get(w) || 0) + 1);
    }
  }

  /* Reservation order decides who wins a contested word.
     Overrides are deliberate choices and go first; names staying
     as they are already own their trigger and go second; only
     then is anything generated. */
  const taken = new Set();

  for (const r of rows) {
    const o = OVERRIDES.get(r.name);
    if (o) {
      r.proposed = o;
      r.manual = true;
      taken.add(trigger(o).toLowerCase());
    }
  }
  for (const r of rows) {
    if (!r.manual && r.len <= max) taken.add(trigger(r.cleaned).toLowerCase());
  }

  /* ---------------------------------------------------------
     BASE NAMES BEFORE THEIR VARIANTS.

     Sorting purely by length put this backwards: a "(Full)"
     suffix makes a name LONGER, so the variant sorted first and
     took the plain word. "...Madman (Full)" claimed ^madman and
     left the base version with ^madmansome.

     The base recording is the one people mean. A reward counts
     as a variant when stripping a trailing "full" leaves a name
     that actually exists in this list — inferred from the data
     rather than guessing at whatever punctuation was used.
  --------------------------------------------------------- */
  const allTriggers = new Set(rows.map((r) => trigger(r.cleaned).toLowerCase()));

  const isVariant = (r) => {
    const t = trigger(r.cleaned).toLowerCase();
    const base = t.replace(/full$/, "");
    return base !== t && allTriggers.has(base);
  };

  const claim = (candidate) => {
    const t = trigger(candidate).toLowerCase();
    if (!t || t.length < 3 || taken.has(t)) return null;
    taken.add(t);
    return candidate;
  };

  const toShorten = rows
    .filter((r) => !r.manual && r.len > max)
    .sort((a, b) => (isVariant(a) - isVariant(b)) || b.len - a.len);

  for (const r of toShorten) {
    const words = r.cleaned.split(" ").filter(Boolean);

    const scored = words
      .map((w) => {
        let s = Math.min(w.length, 12);
        if (STOP.has(w.toLowerCase())) s -= 20;
        s -= ((df.get(w.toLowerCase()) || 1) - 1) * 3;
        if (/^\d+$/.test(w)) s -= 6;
        return { w, s };
      })
      .sort((a, b) => b.s - a.s);

    r.proposed =
      claim(scored[0]?.w || "") ||
      claim([scored[0]?.w, scored[1]?.w].filter(Boolean).join("")) ||
      claim((scored[0]?.w || "") + r.speaker) ||
      claim([scored[0]?.w, scored[1]?.w, scored[2]?.w].filter(Boolean).join("")) ||
      claim(words.slice(0, 3).join("")) ||
      null;
  }

  /* Final shape for every reward, whatever route it took. */
  for (const r of rows) {
    r.finalName = r.proposed || (r.len <= max ? r.cleaned : r.name);
    r.finalTrigger = trigger(r.finalName).toLowerCase();
    r.changed = r.finalName !== r.name;

    /* Where the rename would destroy the wording, the original
       phrase is appended to the description in the SAME patch.
       Renaming and preserving must not be two operations — a run
       that half-completed would otherwise lose text permanently. */
    r.finalDescription =
      r.changed && !r.phraseSafe
        ? `${r.description}${r.description ? " " : ""}(${r.name})`.trim()
        : null;

    r.action = r.manual
      ? "manual"
      : !r.changed
        ? "none"
        : r.len > max
          ? "shorten"
          : "depunctuate";
  }

  /* ---------------------------------------------------------
     THE CHECK THAT MATTERS.

     Four routes decide a final name by different rules and each
     avoids collisions within itself. Nothing above proves they
     agree with EACH OTHER.

     Two rewards sharing a trigger is the one failure invisible
     in the output: both lines look reasonable alone, and it
     surfaces on stream when a viewer types the word and the
     wrong sound plays. Lower-cased, because that is how Velora
     matches.
  --------------------------------------------------------- */
  const byTrigger = new Map();
  for (const r of rows) {
    if (!byTrigger.has(r.finalTrigger)) byTrigger.set(r.finalTrigger, []);
    byTrigger.get(r.finalTrigger).push(r.finalName);
  }

  const clashes = [...byTrigger.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([t, names]) => ({ trigger: t, names }));

  return { rows, clashes };
}
