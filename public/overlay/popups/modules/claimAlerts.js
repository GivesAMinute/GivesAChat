// public/overlay/popups/modules/claimAlerts.js

import sharedPopups from "/overlay/shared/_sharedPopups.js";
import { renderVeloraAlertCard } from "./veloraRendererPopups.js";
import { runConfetti, runBalloons } from "./celebrations.js";
import {
  veloraCardValues,
  renderVeloraTemplate
} from "/overlay/shared/veloraCardVariables.js";

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

/* 15s -> 22s. The effects now stop respawning partway through
   and taper out, and the thinning-out needs runtime to be worth
   watching. See RESPAWN_FRACTION in celebrations.js. */
const EFFECT_DURATION_MS = 22000;
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

   Every token in those lines is now resolvable. {Times} comes
   from counts.lifetime and {Place} from builtInType — both were
   missing from the payload originally and were added by Velora
   after we asked. Substitution follows their documented rules
   and lives in the shared module.
--------------------------------------------------------- */
export function buildClaimText(data, place) {
  const design = data.cardDesign || {};

  /* Our own reward-id match is passed as the fallback only.
     builtInType wins when present — it is Velora's own answer to
     the same question, and it survives the rewards being
     recreated with new ids. */
  const values = veloraCardValues(data, { place });

  const line1 =
    renderVeloraTemplate(design.textLine1?.content, values).trim() ||
    `${values.user} was ${values.place || place} to the stream!`;

  const line2 = renderVeloraTemplate(design.textLine2?.content, values).trim();

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
   Avatar

   Goes straight onto img.src, so it is checked before use — an
   author-supplied field should never reach a src unvalidated.
   Falls back to the Velora mark rather than null, which would
   render as a broken image icon.
--------------------------------------------------------- */
function claimAvatar(data) {
  const url = data.avatarUrl || data.userAvatarUrl || data.profileImageUrl;

  if (typeof url === "string" && /^https:\/\/[^"'<>\s]+$/i.test(url)) {
    return url;
  }

  return "/icons/velora.png";
}

/* ---------------------------------------------------------
   Render

   Uses the "stream alert" bubble — the gold-bordered card the
   chat overlay already uses for follows, subs and Volts — rather
   than the big sticker treatment other popups get.

   Two deliberate differences from the chat overlay's version:
   no platform icon outside the bubble, and no slide-out. This
   overlay is a standalone card in the middle of the screen, not
   a message in a lane, so sliding it sideways makes no sense.

   Queued through renderVeloraAlertCard so two claims arriving
   together don't draw on top of each other; the variant tells
   the renderer which card to build.

   Sound and celebration are ours; lifetime and fade are the
   renderer's.
--------------------------------------------------------- */
export function renderClaimAlert(data) {
  const claim = identifyClaim(data);
  if (!claim) return false;

  const { line1, line2 } = buildClaimText(data, claim.place);

  sharedPopups.wake();
  sharedPopups.markPopupEvent();

  renderVeloraAlertCard({
    variant: "claim",
    event: "channel.stream_alert",
    alertType: "claim",
    timestamp: Date.now(),

    line1,
    line2,

    displayName: data.displayName || data.username || null,
    username: data.username || null,
    avatarUrl: claimAvatar(data),

    cardDesign: normaliseCardDesign(data, line1, line2),

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
