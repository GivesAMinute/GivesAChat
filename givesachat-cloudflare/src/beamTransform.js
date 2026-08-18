// givesachat-cloudflare/src/beamTransform.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   Beam asset CDN

   Beam sends bare UUIDs for its own assets (emotes, stickers,
   avatars) rather than full URLs. Everything relayed from
   another platform — YouTube and Pilled avatars, Klipy GIFs —
   arrives as an absolute URL and is used as-is.

   Beam's CDN uses "<id>-<variant>.<ext>". The emote and avatar
   forms below are confirmed against live URLs taken from the
   Beam client:

     emotes/12ed830a-...-64.png
     avatars/b6e5786f-...-tiny.jpeg

     stickers/fcb82977-...-128.png

   Note the extension is always .png, including for animated
   stickers. The payload's formats:["apng"] describes the
   encoding, not the file extension — animated PNGs are still
   served as .png. Using "apng" there 404s every sticker.

   If Beam moves its CDN, these three functions are the only
   thing that needs changing.
--------------------------------------------------------- */
const ASSET_BASE = "https://content.beamstream.gg";

export const beamEmoteUrl = (src) =>
  `${ASSET_BASE}/emotes/${src}-64.png`;

export const beamAvatarUrl = (src) =>
  `${ASSET_BASE}/avatars/${src}-tiny.jpeg`;

export const beamStickerUrl = (src, asset = {}) => {
  const size = Array.isArray(asset.sizes) && asset.sizes.length
    ? asset.sizes[0]
    : 128;

  return `${ASSET_BASE}/stickers/${src}-${size}.png`;
};

/* ---------------------------------------------------------
   Platforms to drop from the Beam feed.

   Velora is excluded because the overlay has its own direct
   Velora pipeline — without this every Velora message would
   appear twice.

   The rest are excluded pre-emptively, on one rule: ANY
   platform we ingest directly must be filtered out of Beam.
   Beam doesn't relay Blaze, VPZONE or Arena today, but it
   aggregates platforms and adds them over time — and the day
   it adds one we already carry, every message from it would
   silently start appearing twice, mid-stream, with no code
   change on our side to explain it.

   Filtering ahead of time costs nothing and removes that
   entire failure mode. When adding a new platform to the
   overlay, add it here at the same time.
--------------------------------------------------------- */
export const IGNORED_SENDER_TYPES = [
  "velora",   // direct: webhook -> ChatRoom
  "blaze",    // direct: Socket.IO in the overlay
  "vpzone",   // direct: WebSocket in VPZoneRoom
  "arena",    // direct: polled by ArenaRoom
  "odysee",   // direct: Commentron socket in OdyseeRoom
  "bitchute"  // direct: Socket.IO in BitChuteRoom
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * senderMeta.avatarUrl arrives in three different shapes:
 *   beam            → bare UUID          → build a CDN URL
 *   youtube, pilled → absolute https URL → use as-is
 *   kick, twitch    → null               → no avatar
 */
function resolveAvatar(avatarUrl) {
  if (!avatarUrl || typeof avatarUrl !== "string") return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  if (UUID_RE.test(avatarUrl)) return beamAvatarUrl(avatarUrl);
  return null;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Emote and sticker names arrive wrapped in colons (":heart:").
 * Strip them so text-to-speech reads "heart" rather than
 * "colon heart colon".
 */
function cleanName(name) {
  return String(name || "").replace(/^:+|:+$/g, "").trim();
}

/* ---------------------------------------------------------
   Quill Delta → HTML

   Beam has no text formatting, so this only needs to handle
   the embed types: emote, sticker and gif. Anything
   unrecognised is skipped rather than guessed at.
--------------------------------------------------------- */
export function deltaToHtml(ops) {
  if (!Array.isArray(ops)) return "";

  return ops
    .map((op) => {
      const insert = op?.insert;

      // Plain text
      if (typeof insert === "string") return sanitizeHtml(insert);

      if (!insert || typeof insert !== "object") return "";

      // Custom emote — { id, src (UUID), name, type, source }
      if (insert.type === "emote" && insert.src) {
        const alt = escapeAttr(cleanName(insert.name));
        return `<img class="beam-emote" src="${escapeAttr(
          beamEmoteUrl(insert.src)
        )}" alt="${alt}">`;
      }

      // Sticker — { id, name, type, asset: { src, animated, ... } }
      if (insert.type === "sticker" && insert.asset?.src) {
        const alt = escapeAttr(cleanName(insert.name));
        const url = beamStickerUrl(insert.asset.src, insert.asset);
        return `<img class="beam-sticker" src="${escapeAttr(url)}" alt="${alt}">`;
      }

      // GIF — Klipy embed, absolute URLs already
      if (insert.type === "gif") {
        const url = insert.url || insert.gifUrl || insert.previewUrl;
        if (!url || !/^https?:\/\//i.test(url)) return "";
        const alt = escapeAttr(insert.title || "gif");
        return `<img class="beam-gif" src="${escapeAttr(url)}" alt="${alt}">`;
      }

      /* -----------------------------------------------------
         Unrecognised embed.

         Relayed platforms (Kick, Twitch, YouTube) may describe
         emotes differently to Beam's own. Rather than return
         nothing — which silently deletes the entire message
         when the embed is all it contains — fall back to any
         absolute image URL on the object, then to its name.

         The warning makes the real shape visible in
         `wrangler tail` so it can be handled properly.
      ----------------------------------------------------- */
      console.warn(
        "[BEAM] unhandled insert:",
        JSON.stringify(insert).slice(0, 400)
      );

      const fallbackUrl =
        insert.url || insert.src || insert.imageUrl || insert.emoteUrl;

      if (typeof fallbackUrl === "string" && /^https?:\/\//i.test(fallbackUrl)) {
        const alt = escapeAttr(cleanName(insert.name || insert.title || ""));
        return `<img class="beam-emote" src="${escapeAttr(fallbackUrl)}" alt="${alt}">`;
      }

      const label = cleanName(insert.name || insert.title || "");
      return label ? sanitizeHtml(label) : "";
    })
    .join("");
}

/* ---------------------------------------------------------
   Beam SSE message → overlay chat payload

   The returned shape matches what the Velora pipeline already
   produces, so the overlay renders it through the same bubble,
   avatar and username path with no special casing.

   platform is set to the ORIGIN platform (twitch, kick,
   youtube, pilled, beam...) so the icon outside the bubble
   reflects where the message actually came from. `via` records
   that it was relayed through Beam, which is what tells the
   renderer to use Beam's badge artwork.
--------------------------------------------------------- */
export function transformBeamMessage(raw) {
  if (!raw || typeof raw !== "object") return null;

  const senderType = String(raw.senderType || "beam").toLowerCase();

  if (IGNORED_SENDER_TYPES.includes(senderType)) return null;

  const meta = raw.senderMeta || {};
  const html = deltaToHtml(raw.content?.ops);

  // Nothing renderable (unknown embed type, empty message)
  if (!html.trim()) return null;

  return {
    type: "chat",
    platform: senderType,
    via: "beam",

    messageId: raw.id || null,
    username: sanitizeHtml(meta.displayName || "Unknown"),
    avatar: resolveAvatar(meta.avatarUrl),
    badges: Array.isArray(meta.badges) ? meta.badges : [],

    // Kept so BeamRoom can look up avatars for platforms whose
    // pictures Beam doesn't relay (Kick sends avatarUrl: null).
    profileUrl: typeof meta.profileUrl === "string" ? meta.profileUrl : null,

    html,

    timestamp: raw.createdAtMs || Date.now()
  };
}
