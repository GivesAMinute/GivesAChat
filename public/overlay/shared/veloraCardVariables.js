// public/overlay/shared/veloraCardVariables.js

/* ---------------------------------------------------------
   Velora card template variables

   When you render a creator's own cardDesign yourself, the
   template text arrives with its {Tokens} intact — Velora only
   substitutes them on their own overlays.

   Spec: https://developer.velora.tv/docs/card-variables

   Two rules from that page worth stating out loud, because both
   are the opposite of the obvious implementation:

   1. SUBSTITUTE IN ONE PASS. A chain of .replace() calls
      re-scans text it has already written, so a viewer whose
      message contains "{Reward}" would have it expanded by a
      later step. One regex, one pass, no re-entry.

   2. LEAVE UNKNOWN TOKENS ALONE. A token we don't recognise is
      almost always the creator's typo. Rendering it as written
      shows them the mistake; deleting it hides it forever.

   Known-but-inapplicable tokens resolve to "" — {Viewers} on a
   channel-points redemption has no meaningful value, and an
   empty string is the documented result.
--------------------------------------------------------- */

/* {Times} is a COUNT in Velora's spec — counts.lifetime, so a
   viewer's ninth redeem is the number 9. But creators write
   templates like "This is their {times} time claiming {place}!",
   which reads as "their 9 time".

   Rendering the ordinal keeps that sentence grammatical. It is a
   deliberate divergence from Velora's own overlay, so it is a
   flag rather than something buried in the code: set this to
   false to match Velora exactly. */
const ORDINALISE_TIMES = true;

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* builtInType is Velora's own marker for the first/second
   redeemer of a stream. It is authoritative — our reward-id
   matching is only a fallback for when it is absent. */
function placeFrom(builtInType, fallback = "") {
  if (builtInType === "first") return "1st";
  if (builtInType === "second") return "2nd";
  return fallback;
}

/* ---------------------------------------------------------
   {Times} — the redeem count

   Velora OMITS counts.lifetime rather than sending 0 when they
   have no count, so absent means "no data", not "never". The
   documented reading is 1: the redemption in front of you is at
   least the first one.

   Reading a missing count as 0 would render "This is their 0th
   time", which is both wrong and the kind of thing that only
   shows up live.
--------------------------------------------------------- */
function timesFrom(data) {
  const raw = data?.counts?.lifetime ?? data?.templateData?.times;
  const n = Number(raw);

  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/**
 * Build the substitution table for an event payload.
 *
 * @param {object} data      the Velora event payload
 * @param {object} [extra]   overrides, e.g. a place we matched ourselves
 */
export function veloraCardValues(data = {}, extra = {}) {
  const t = data.templateData || {};

  const user = data.displayName || data.username || "Someone";
  const times = timesFrom(data);
  const place = placeFrom(data.builtInType, extra.place || "");

  const values = {
    // {User}, and its three documented aliases
    user,
    name: user,
    displayname: user,
    viewer: user,

    // {Username} / {Handle}
    username: data.username || "",
    handle: data.username || "",

    reward: data.rewardTitle || data.rewardName || data.itemName || "",

    times: ORDINALISE_TIMES ? ordinal(times) : String(times),
    place,

    /* stream_alert carries these on templateData; a redemption
       simply has no value for them, which is an empty string. */
    amount: str(data.amount ?? t.amount),
    months: str(data.months ?? t.months),
    tier: str(data.tier ?? t.tier),
    viewers: str(data.viewers ?? t.viewers),

    message: data.userMessage || data.message || ""
  };

  /* `extra` overrides anything we derived — except {Place}.
     builtInType is Velora's own answer to "was this the first or
     second redeem of the stream", so a caller's guess is only
     ever the fallback, never an override. Spreading extra last
     would silently invert that. */
  return { ...values, ...extra, place };
}

function str(v) {
  return v === undefined || v === null ? "" : String(v);
}

/**
 * Substitute {Tokens} in one pass. Matching is case-insensitive;
 * unknown tokens are returned exactly as written.
 */
export function renderVeloraTemplate(template, values) {
  if (typeof template !== "string") return "";

  return template.replace(/\{([A-Za-z]+)\}/g, (whole, token) => {
    const value = values[token.toLowerCase()];
    return value !== undefined ? String(value) : whole;
  });
}
