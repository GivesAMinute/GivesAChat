// public/overlay/popups/modules/claimAlerts.js

import sharedPopups from "/overlay/shared/_sharedPopups.js";
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

   Velora supplies alertSoundUrl on the redemption. Autoplay
   can be refused in a plain browser tab; OBS allows it.
--------------------------------------------------------- */
function playClaimSound(data) {
  const url = data.alertSoundUrl || data.customSoundUrl;
  if (!url) return;

  try {
    const audio = new Audio(url);
    audio.volume = Number(data.itemSoundVolume) || 0.8;
    audio.play().catch((err) => {
      console.warn("[Claim] sound blocked:", err?.message || err);
    });
  } catch (err) {
    console.warn("[Claim] sound failed:", err);
  }
}

/* ---------------------------------------------------------
   Render — mirrors the stripped-down chat-lane system alert
   (Velora icon beside a dark bubble), shown in the popups
   overlay instead of the chat lane.
--------------------------------------------------------- */
export function renderClaimAlert(data) {
  const claim = identifyClaim(data);
  if (!claim) return false;

  const container =
    document.getElementById("alert-container") ||
    document.getElementById("overlay-root") ||
    document.body;

  const { line1, line2 } = buildClaimText(data, claim.place);

  const wrapper = document.createElement("div");
  wrapper.className = `claim-alert claim-alert-${claim.place}`;

  const icon = document.createElement("img");
  icon.className = "claim-alert-icon";
  icon.src = "/icons/velora.png";
  icon.alt = "Velora";

  const bubble = document.createElement("div");
  bubble.className = "claim-alert-bubble";

  const l1 = document.createElement("div");
  l1.className = "claim-alert-line1";
  l1.textContent = line1;
  bubble.appendChild(l1);

  if (line2) {
    const l2 = document.createElement("div");
    l2.className = "claim-alert-line2";
    l2.textContent = line2;
    bubble.appendChild(l2);
  }

  wrapper.appendChild(icon);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);

  sharedPopups.wake();
  sharedPopups.markPopupEvent();

  playClaimSound(data);

  if (claim.effect === "confetti") runConfetti(EFFECT_DURATION_MS);
  else runBalloons(EFFECT_DURATION_MS);

  const holdMs = (Number(data.alertDuration) * 1000) || CARD_FALLBACK_MS;

  setTimeout(() => {
    wrapper.classList.add("claim-alert-out");
    setTimeout(() => wrapper.remove(), 600);
  }, holdMs);

  return true;
}
