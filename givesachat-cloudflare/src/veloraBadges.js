// givesachat-cloudflare/src/veloraBadges.js

import { getVeloraAccessToken } from "./veloraAuth.js";

/* ---------------------------------------------------------
   Velora badge catalog

   Chat messages carry badges as an array of slugs:

     "badges": ["broadcaster", "moderator", "pride-month-2026"]

   The overlay used to hardcode six of these and silently drop
   everything else, so any event badge a viewer had earned
   simply didn't render. pride-month-2026 was pasted in with a
   literal CDN url — and that url contains a uuid that can't be
   derived from the slug, which is why hardcoding was the only
   option at the time.

   /api/badges/catalog resolves all of them:

     { badges: [ { slug, name, staticAssetUrl, animatedAssetUrl } ] }

   Role badges (broadcaster, moderator, vip, gift_leader) are
   NOT resolved here — the overlay has its own artwork for
   those and it should keep using it. This only fills the gap
   for catalog badges.
--------------------------------------------------------- */

const CATALOG_URL = "https://api.velora.tv/api/badges/catalog";

// Refetch occasionally so newly added badges appear without a
// deploy. Cheap: one request per worker isolate per hour.
const CATALOG_TTL_MS = 60 * 60 * 1000;

/* ---------------------------------------------------------
   Rendered from local artwork by badges/velora/index.js, or —
   for subscriptions — from the channel's own badge set.
   Anything outside this list is resolved from the catalog.

   BOTH SPELLINGS ARE HERE ON PURPOSE. Velora's docs show the
   wire value as "subscriber":

     "badges": ["subscriber", "moderator"]

   but this set only had "subscription". So a subscriber's badge
   was treated as an unknown catalog badge, looked up, not found,
   and dropped — while the renderer was separately checking for
   "subscription" and never matching either. It failed twice,
   which is why nothing appeared and nothing looked broken.

   Keeping both costs one line and survives them changing it
   back.
--------------------------------------------------------- */
export const ROLE_BADGES = new Set([
  "broadcaster",
  "moderator",
  "vip",
  "gift_leader",
  "subscriber",
  "subscription"
]);

export const SUBSCRIBER_SLUGS = new Set(["subscriber", "subscription"]);

let catalog = new Map();
let catalogFetchedAt = 0;
let inFlight = null;

async function loadCatalog(env) {
  const fresh = Date.now() - catalogFetchedAt < CATALOG_TTL_MS;
  if (fresh && catalog.size) return catalog;

  // Collapse concurrent callers onto one request.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const token = await getVeloraAccessToken(env);
      if (!token) {
        console.warn("[VELORA] no token — badge catalog unavailable");
        return catalog;
      }

      const res = await fetch(CATALOG_URL, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });

      if (!res.ok) {
        console.warn("[VELORA] badge catalog returned", res.status);
        return catalog;
      }

      const json = await res.json();
      const badges = Array.isArray(json?.badges) ? json.badges : [];

      const next = new Map();
      for (const badge of badges) {
        if (!badge?.slug) continue;

        next.set(badge.slug, {
          slug: badge.slug,
          name: badge.name || badge.slug,
          url: badge.animatedAssetUrl || badge.staticAssetUrl || null
        });
      }

      if (next.size) {
        catalog = next;
        catalogFetchedAt = Date.now();
        console.log(`[VELORA] badge catalog: ${catalog.size} badges`);
      }

      return catalog;
    } catch (err) {
      console.error("[VELORA] badge catalog error:", err);
      return catalog;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/* ---------------------------------------------------------
   Subscription badges — the channel's own artwork

   GET /api/badges/channel/:username  (public, no token)

     { channel, badges: [
         { id, months, label, staticAssetUrl, animatedAssetUrl }
     ]}

   Keyed by MONTHS, not tier: 2, 3, 6, 9, 12, 18, 24, 36 …
   plus one entry with months: null, labelled "New Subscriber",
   which is the base badge everyone starts with.

   So rendering the right badge needs to know how long someone
   has been subscribed. When the message doesn't say, the base
   badge is correct — it is what Velora shows a new subscriber —
   and showing it beats showing nothing.
--------------------------------------------------------- */
const SUB_BADGE_TTL_MS = 60 * 60 * 1000;

let subBadges = [];        // sorted ascending by months
let subBaseBadge = null;   // the months: null entry
let subFetchedAt = 0;
let subInFlight = null;

async function loadSubBadges(env) {
  const channel = env?.VELORA_CHANNEL || "GivesAMinute";

  const fresh = Date.now() - subFetchedAt < SUB_BADGE_TTL_MS;
  if (fresh && (subBadges.length || subBaseBadge)) return;

  if (subInFlight) return subInFlight;

  subInFlight = (async () => {
    try {
      const res = await fetch(
        `https://api.velora.tv/api/badges/channel/${encodeURIComponent(channel)}`,
        { headers: { Accept: "application/json" } }
      );

      if (!res.ok) {
        console.warn("[VELORA] channel badges returned", res.status);
        return;
      }

      const json = await res.json();
      const rows = Array.isArray(json?.badges) ? json.badges : [];
      if (!rows.length) return;

      const tiered = [];
      let base = null;

      for (const b of rows) {
        const url = b.animatedAssetUrl || b.staticAssetUrl;
        if (!url) continue;

        const entry = {
          months: b.months == null ? null : Number(b.months),
          label: b.label || "Subscriber",
          url
        };

        if (entry.months == null) base = entry;
        else tiered.push(entry);
      }

      tiered.sort((a, b) => a.months - b.months);

      subBadges = tiered;
      subBaseBadge = base;
      subFetchedAt = Date.now();

      console.log(
        `[VELORA] subscription badges: ${tiered.length} tiers` +
          (base ? " + base" : " (no base badge)")
      );
    } catch (err) {
      console.error("[VELORA] channel badge error:", err);
    } finally {
      subInFlight = null;
    }
  })();

  return subInFlight;
}

/**
 * The subscription badge for one message.
 *
 * Velora may send a resolved `subscriptionBadge` on the message.
 * If it does, that wins — it knows more than we do. Otherwise we
 * match on months if the payload carries them, and fall back to
 * the base badge.
 *
 * @returns {Promise<{url,label}|null>}
 */
export async function resolveSubscriptionBadge(msg, env) {
  const slugs = Array.isArray(msg?.badges) ? msg.badges : [];

  const isSub =
    slugs.some((s) => SUBSCRIBER_SLUGS.has(s)) ||
    msg?.isSub === true ||
    msg?.isSubscriber === true;

  if (!isSub) return null;

  // Velora's own resolved badge, when present.
  const own = msg?.subscriptionBadge;
  if (own?.staticAssetUrl || own?.animatedAssetUrl) {
    return {
      url: own.animatedAssetUrl || own.staticAssetUrl,
      label: own.label || "Subscriber"
    };
  }

  await loadSubBadges(env);

  /* Months, under whatever name it arrives. The docs document
     subTier but not months, so this is defensive: if none of
     these are present we simply use the base badge. */
  const months = Number(
    msg?.subMonths ?? msg?.months ?? msg?.subscriptionMonths ?? NaN
  );

  if (Number.isFinite(months) && subBadges.length) {
    /* Highest tier they have actually reached — walking up and
       keeping the last match, so 7 months gets the 6-month badge
       rather than the 9-month one. */
    let match = null;
    for (const b of subBadges) {
      if (months >= b.months) match = b;
      else break;
    }
    if (match) return { url: match.url, label: match.label };
  }

  if (subBaseBadge) {
    return { url: subBaseBadge.url, label: subBaseBadge.label };
  }

  return null;
}

/**
 * Resolve the non-role badges on a message to renderable assets.
 *
 * @param {string[]} slugs  message.badges
 * @returns {Promise<Array<{slug,name,url}>>}
 */
export async function resolveVeloraBadges(slugs, env) {
  if (!Array.isArray(slugs) || !slugs.length) return [];

  const unknown = slugs.filter((s) => typeof s === "string" && !ROLE_BADGES.has(s));
  if (!unknown.length) return [];

  const map = await loadCatalog(env);
  const resolved = [];

  for (const slug of unknown) {
    const entry = map.get(slug);

    if (!entry?.url) {
      console.warn("[VELORA] badge not in catalog:", slug);
      continue;
    }

    resolved.push(entry);
  }

  return resolved;
}
