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
/* VPZONE was here until Beam began relaying it. Removing it from
   this list is what switches the platform over: our own reader is
   gone, and Beam's copy is now allowed through instead. Emotes and
   badges survive the relay; avatars are refilled by BeamRoom. */
/* Blaze was here too, and it never matched a thing. Beam calls it
   "blazestream", so the duplicate walked straight past a list that
   was watching for "blaze" — see PLATFORM_ALIASES below. It is now
   deliberately absent: Beam is the Blaze source, and putting it
   back would silently switch Blaze off. */
export const IGNORED_SENDER_TYPES = [
  "velora",   // direct: webhook -> ChatRoom
  "arena",    // direct: polled by ArenaRoom
  "odysee",   // direct: Commentron socket in OdyseeRoom
  "bitchute", // direct: Socket.IO in BitChuteRoom
  "facebook"  // direct: live_comments SSE in FacebookRoom
];

/* ---------------------------------------------------------
   Beam's name for a platform → ours.

   Beam relays Blaze as "blazestream". Our icons, CSS classes,
   badge artwork and username palette are all keyed on the
   string "blaze", so an unmapped label costs all four at once:
   /icons/blazestream.png 404s to the Beam icon, .blaze styling
   never applies, and colorForUsername() falls back to a
   generic palette instead of Blaze orange.

   Mapped here rather than at each of those four sites, so a
   platform is renamed in exactly one place.
--------------------------------------------------------- */
const PLATFORM_ALIASES = {
  blazestream: "blaze"
};

/* ---------------------------------------------------------
   Beam sends badges as objects — [{type:"owner"},{type:"vip"}] —
   while renderBlazeBadges() reads plain role strings plus a
   separate isOwner flag, because that is the shape Blaze's own
   API used.

   Confirmed from a real relayed message, not assumed:
     badges=[{"type":"owner"},{"type":"moderator"},{"type":"vip"}]

   Both shapes are accepted, since a bare string costs one
   `typeof` to support and Beam has changed payload shapes before.
--------------------------------------------------------- */
function beamBadgesToRoles(badges) {
  if (!Array.isArray(badges)) return [];

  return badges
    .map((b) => (typeof b === "string" ? b : b?.type))
    .filter((t) => typeof t === "string" && t)
    .map((t) => t.toLowerCase());
}

/* ---------------------------------------------------------
   Hosts allowed to appear in a relayed emote's src.

   Beam relays emotes as absolute urls belonging to the ORIGIN
   platform, so this list grows as Beam adds platforms. An emote
   from anywhere else renders as its name in text rather than
   loading, and says so in the log.

   supabase.co is VPZONE's emote storage — confirmed from a real
   relayed frame, not guessed.
--------------------------------------------------------- */
/* ---------------------------------------------------------
   ⭐ ggpht.com is where YouTube chat emoji actually live.

   YouTube emoji were rendering as their own names — a message
   reading literally "face-green-smiling" — which is this list
   rejecting the url and falling back to the name, exactly as
   designed. ytimg.com was in here on the assumption that it
   covered YouTube images. It does not: ytimg.com serves
   thumbnails and static assets, while chat emoji and avatars
   come from yt3.ggpht.com.

   googleusercontent.com is included alongside it because
   YouTube serves the same images from there too, and which one
   you get is not something the sender controls.

   Both are broader than the platform-specific hosts above, so
   the mismatch warning below is deliberately kept: an emote
   from anywhere unexpected still names its host in the log
   rather than being quietly allowed through.
--------------------------------------------------------- */
const RELAYED_EMOTE_HOST =
  /^https:\/\/(?:[a-z0-9-]+\.)*(?:supabase\.co|vpzone\.tv|beamstream\.gg|kick\.com|twitch\.tv|jtvnw\.net|ytimg\.com|ggpht\.com|googleusercontent\.com|pilled\.net)\/[^"'<>\s]*$/i;

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

      /* -----------------------------------------------------
         RELAYED emote — { id, name, type, source, url }

         A platform Beam relays sends its emotes as absolute
         urls rather than Beam's own UUIDs:

           { type: "emote", name: "dealwithit", source: "vpzone",
             url: "https://….supabase.co/…/dealwithit.png" }

         These were rendering only by accident, via the
         unhandled-embed fallback at the bottom of this function
         — which worked, but logged a warning per emote and put
         an unchecked third-party url straight into a src.

         Handled properly here, behind a host allowlist. The
         class carries the source so each platform's emotes can
         be sized independently, the way vpzone-emote already is.
      ----------------------------------------------------- */
      if (insert.type === "emote" && insert.url) {
        if (!RELAYED_EMOTE_HOST.test(insert.url)) {
          console.warn(
            "[BEAM] relayed emote from an unexpected host:",
            String(insert.url).slice(0, 120)
          );
          return sanitizeHtml(cleanName(insert.name) || "");
        }

        const source = String(insert.source || "beam")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");

        const alt = escapeAttr(cleanName(insert.name));

        /* NOT beam-emote. A relayed emote belongs to the origin
           platform, and .beam-emote is 84px against VPZONE's
           34px — tagging them as Beam's would have silently
           rendered every VPZONE emote two and a half times
           bigger, because beam.css loads after styles.css.

           .relayed-emote is the shared default; the source class
           overrides it per platform, exactly as .vpzone-emote
           already does. */
        return (
          `<img class="relayed-emote ${source}-emote" ` +
          `src="${escapeAttr(insert.url)}" alt="${alt}" title="${alt}">`
        );
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

  const platform = PLATFORM_ALIASES[senderType] || senderType;

  const meta = raw.senderMeta || {};
  const html = deltaToHtml(raw.content?.ops);

  // Nothing renderable (unknown embed type, empty message)
  if (!html.trim()) return null;

  const rawBadges = Array.isArray(meta.badges) ? meta.badges : [];

  /* ---------------------------------------------------------
     Blaze keeps its own badges even though it arrives via Beam.

     Everything else Beam relays uses Beam's badge artwork, on
     the reasoning that Beam supplies the badge data so Beam's
     icons match it. Blaze is the exception because we already
     have its real artwork — broadcaster, og, vip, mod — and the
     point of moving the pull to Beam was to keep this render,
     not to inherit Beam's crown and wrench.

     isOwner is split out of the roles list because that is what
     renderBlazeBadges() reads; Beam has no separate flag for it.
  --------------------------------------------------------- */
  const isBlaze = platform === "blaze";
  const roles = isBlaze ? beamBadgesToRoles(rawBadges) : null;

  return {
    type: "chat",
    platform,
    via: "beam",

    messageId: raw.id || null,
    username: sanitizeHtml(meta.displayName || "Unknown"),
    avatar: resolveAvatar(meta.avatarUrl),
    badges: isBlaze ? roles : rawBadges,
    ...(isBlaze && {
      isOwner: roles.includes("owner") || roles.includes("broadcaster")
    }),

    // Kept so BeamRoom can look up avatars for platforms whose
    // pictures Beam doesn't relay (Kick sends avatarUrl: null).
    profileUrl: typeof meta.profileUrl === "string" ? meta.profileUrl : null,

    html,

    timestamp: raw.createdAtMs || Date.now()
  };
}
