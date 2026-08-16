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

/* Rendered from local artwork by badges/velora/index.js.
   Anything outside this set gets resolved from the catalog. */
export const ROLE_BADGES = new Set([
  "broadcaster",
  "moderator",
  "vip",
  "gift_leader",
  "subscription"
]);

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
