// givesachat-cloudflare/src/vpzoneTransform.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   VPZONE chat frames

   Built from their published OpenAPI spec rather than from
   captured traffic — VPZONE documents the frame contract and
   states that changes are additive, so unknown `type` values
   and unknown fields must be ignored rather than treated as
   errors.

   The pleasant surprise is emoteMap: every `msg` frame carries
   its own token -> image URL map, described as "Render emotes
   from this map, never from a global dictionary — it already
   reflects what the sender was entitled to use." That removes
   the entire class of problem we hit on Blaze and Velora,
   where resolving an emote meant maintaining a catalogue.
--------------------------------------------------------- */

// Only these hosts may appear in an emote or avatar src.
const VPZONE_ASSET_HOST = /^https:\/\/[a-z0-9.-]*\.?(vpzone\.tv|supabase\.co)\//i;

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function safeVpzoneAsset(url) {
  return typeof url === "string" && VPZONE_ASSET_HOST.test(url) ? url : null;
}

/* ---------------------------------------------------------
   Body + emoteMap -> HTML

   The body is escaped first, then whole-token matches are
   swapped for images. Splitting on whitespace means a token
   can only ever replace a complete word, so an emote code
   appearing inside a longer word is left alone.
--------------------------------------------------------- */
export function renderVpzoneBody(body, emoteMap) {
  const escaped = sanitizeHtml(body || "");

  if (!emoteMap || typeof emoteMap !== "object") return escaped;

  return escaped
    .split(/(\s+)/)
    .map((token) => {
      if (!token.trim()) return token;

      const url = safeVpzoneAsset(emoteMap[token]);
      if (!url) return token;

      return `<img class="vpzone-emote" src="${escapeAttr(url)}" alt="${escapeAttr(token)}">`;
    })
    .join("");
}

/* ---------------------------------------------------------
   Badge flags.

   VPZONE sends booleans, not artwork — there is no badge
   image in their API and none in this repo. The flags are
   carried through on the payload so badges can be added later
   by dropping PNGs into public/badges/vpzone/ and writing a
   renderer, without touching this file.
--------------------------------------------------------- */
const BADGE_FLAGS = [
  ["is_owner", "broadcaster"],
  ["is_mod", "moderator"],
  ["is_founder", "founder"],
  ["is_ambassador", "ambassador"],
  ["is_subscriber", "subscriber"],
  ["vpz_plus", "vpz_plus"],
  ["guest_pass", "guest_pass"],
  ["has_discord", "discord"]
];

function collectBadges(frame) {
  return BADGE_FLAGS
    .filter(([field]) => frame[field] === true)
    .map(([, name]) => name);
}

/**
 * @param {object} frame  a ChatEvent from the gateway
 * @returns {object|null} overlay chat payload, or null to skip
 */
export function transformVpzoneFrame(frame) {
  if (!frame || typeof frame !== "object") return null;

  // Only chat messages reach the lane. follow / subscription /
  // gift / raid / clip / system all carry a human-readable
  // `body` and could be rendered later if wanted.
  if (frame.type !== "msg") return null;

  const html = renderVpzoneBody(frame.body, frame.emoteMap);
  if (!html.trim()) return null;

  return {
    type: "chat",
    platform: "vpzone",

    messageId: frame.id || null,
    username: sanitizeHtml(frame.username || "Unknown"),
    avatar: null,          // filled in by VPZoneRoom if a key is configured
    badges: collectBadges(frame),

    isOwner: frame.is_owner === true,
    isMod: frame.is_mod === true,
    isSubscriber: frame.is_subscriber === true,

    // VPZONE gives each author a chat colour; the overlay's own
    // colourForUsername() is used when this is absent.
    color: typeof frame.color === "string" ? frame.color : null,

    html,

    timestamp: Number(frame.ts) || Date.now()
  };
}
