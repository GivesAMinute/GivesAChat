// public/overlay/popups/modules/claimAlerts.js

import sharedPopups from "/overlay/shared/_sharedPopups.js";
import { renderVeloraAlertCard } from "./veloraRendererPopups.js";
import { runConfetti, runBalloons } from "./celebrations.js";

/* ---------------------------------------------------------
   1st / 2nd GIVER claims

   Velora sends these as ordinary channel point redemptions,
   but they're once-off: only one person can ever be 1st to a
   stream. They get their own treatment in the popups overlay
   rather than scrolling past in the chat lane.

   Matched on reward ID first, since that's exact. Titles are
   a fallback in case the rewards are ever recreated with new
   IDs — recreating them is the one thing that would silently
   break the ID match.
--------------------------------------------------------- */
const CLAIM_REWARDS = {
  "58dd6d31-8df9-43a5-8f45-7015be44eaa2": { place: "1st", effect: "confetti" },
  "f49bd3f1-ae87-4359-b15b-7c28857d036f": { place: "2nd", effect: "balloons" }
};

const TITLE_PATTERNS = [
  { re: /\b(first|1st)\b/i, place: "1st", effect: "confetti" },
  { re: /\b(second|2nd)\b/i, place: "2nd", effect: "balloons" }
];

const EFFECT_DURATION_MS = 15000;
const CARD_FALLBACK_MS = 10000;

export function identifyClaim(data) {
  if (!data) return null;

  const byId = CLAIM_REWARDS[data.rewardId];
  if (byId) return byId;

  const title = String(data.rewardTitle || "");
  for (const { re, place, effect } of TITLE_PATTERNS) {
    if (re.test(title)) return { place, effect };
  }

  return null;
}

export function isClaimRedemption(data) {
  return identifyClaim(data) !== null;
}

/* ---------------------------------------------------------
   Velora's card templates arrive unsubstituted:

     "{username} was the 1st GIVER to this stream!"
     "This is their {times} time claiming {place}!"

   {username} and {place} we can fill. {times} is computed by
   Velora's own client and isn't in the webhook payload — if a
   count ever turns up on the event, add its field name to
   claimCount() below and line two starts rendering.
--------------------------------------------------------- */
function claimCount(data) {
  const candidates = [
    data.times, data.claimCount, data.count,
    data.timesClaimed, data.totalClaims
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fillTemplate(template, { username, place, times }) {
  if (typeof template !== "string") return "";

  return template
    .replace(/\{username\}/gi, username)
    .replace(/\{place\}/gi, place)
    .replace(/\{times\}/gi, times ? ordinal(times) : "");
}

export function buildClaimText(data, place) {
  const username = data.displayName || data.username || "Someone";
  const design = data.cardDesign || {};
  const times = claimCount(data);

  const line1 =
    fillTemplate(design.textLine1?.content, { username, place, times }).trim() ||
    `${username} was ${place} to the stream!`;

  // Only render line two if the count is actually available —
  // "This is their  time claiming 1st!" reads as a bug.
  const line2 = times
    ? fillTemplate(design.textLine2?.content, { username, place, times }).trim()
    : "";

  return { line1, line2 };
}

/* ---------------------------------------------------------
   Sound

   The webhook payload calls it alertSoundUrl, but the popups
   overlay receives these over Velora's socket, which may name
   it differently — so check every plausible field.

   Played here rather than by the alert renderer, which does
   `audio.play().catch(() => {})` and swallows the reason. When
   a sound fails to fire mid-stream, silence is the one thing
   that isn't useful.
--------------------------------------------------------- */
function resolveClaimSound(data) {
  const candidates = [
    data.alertSoundUrl,
    data.customSoundUrl,
    data.soundUrl,
    data.itemSoundUrl,
    data.alertSound,
    data.cardDesign?.sound?.url,
    data.cardDesign?.soundUrl
  ];

  for (const url of candidates) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
  }

  return null;
}

function playClaimSound(data) {
  const url = resolveClaimSound(data);

  if (!url) {
    console.warn(
      "[Claim] no sound URL on payload. Fields present:",
      Object.keys(data || {}).join(", ")
    );
    return;
  }

  console.log("[Claim] playing", url);

  try {
    const audio = new Audio(url);
    audio.volume = Number(data.itemSoundVolume) || 1.0;

    audio.addEventListener("error", () => {
      // .ogg plays in OBS (Chromium) but not Safari/iOS
      console.warn("[Claim] audio failed to load:", url, audio.error?.code);
    });

    audio.play()
      .then(() => console.log("[Claim] sound started"))
      .catch((err) => {
        console.warn(
          "[Claim] play() refused:",
          err?.name || err,
          "— likely autoplay policy; OBS normally allows it"
        );
      });
  } catch (err) {
    console.warn("[Claim] audio threw:", err);
  }
}

/* ---------------------------------------------------------
   Velora's cardDesign stores colours as objects:

     "color": { "type": "solid", "value": "#ffffff" }

   but renderVeloraAlertCardNow assigns card.textLine1.color
   straight to style.color, which silently does nothing with an
   object. Flattening it here means the card actually picks up
   Velora's intended colour.
--------------------------------------------------------- */
function flattenColor(color) {
  if (!color) return null;
  if (typeof color === "string") return color;
  return color.value || color.color || null;
}

function normaliseCardDesign(data, line1, line2) {
  const design = data.cardDesign || {};

  return {
    ...design,
    textLine1: {
      ...(design.textLine1 || {}),
      content: line1,
      color: flattenColor(design.textLine1?.color)
    },
    textLine2: line2
      ? {
          ...(design.textLine2 || {}),
          content: line2,
          color: flattenColor(design.textLine2?.color)
        }
      : undefined
  };
}

/* ---------------------------------------------------------
   Render — uses the standard Velora stream alert card, the
   same treatment follows, raids and subs get in popups.

   The text is passed as `message` because resolvePopupText()
   returns that verbatim when present, which lets us hand over
   the substituted string instead of Velora's raw template.

   Sound and card lifetime are handled by the alert renderer;
   all we add is the celebration.
--------------------------------------------------------- */
export function renderClaimAlert(data) {
  const claim = identifyClaim(data);
  if (!claim) return false;

  const { line1, line2 } = buildClaimText(data, claim.place);
  const message = [line1, line2].filter(Boolean).join("  ");

  sharedPopups.wake();
  sharedPopups.markPopupEvent();

  renderVeloraAlertCard({
    event: "channel.stream_alert",
    alertType: "claim",
    timestamp: Date.now(),

    // resolvePopupText() returns this as-is
    message,

    displayName: data.displayName || data.username || null,
    username: data.username || null,

    cardDesign: normaliseCardDesign(data, line1, line2),

    // The claimer's own avatar, falling back to the Velora mark.
    // Never null: the renderer assigns whatever it gets straight
    // to img.src, and null becomes a broken image.
    customImageUrl: data.avatarUrl || "/icons/velora.png",

    // Deliberately null — the sound is played by playClaimSound()
    // below so failures are reported rather than swallowed.
    // Setting this too would play it twice.
    customSoundUrl: null,

    duration: Number(data.alertDuration) || CARD_FALLBACK_MS / 1000
  });

  playClaimSound(data);

  if (claim.effect === "confetti") runConfetti(EFFECT_DURATION_MS);
  else runBalloons(EFFECT_DURATION_MS);

  return true;
}
