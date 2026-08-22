// givesachat-cloudflare/src/vpzoneAvatars.js

/* ---------------------------------------------------------
   VPZONE avatars for Beam-relayed messages

   Beam now relays VPZONE chat, which let us delete our own
   VPZONE reader — one fewer durable object holding a socket
   round the clock. The relay keeps almost everything:

     emotes    kept, as absolute urls on the delta
     badges    kept, as [{ type: "owner" }]
     avatars   LOST — senderMeta.avatarUrl is null

   Confirmed from a real relayed frame, not assumed.

   So the lookup that used to live inside VPZoneRoom moves here
   and is called from BeamRoom instead, exactly as
   kickAvatars.js already does for relayed Kick messages, which
   arrive with the same gap.

   Chat frames never carried an avatar even on the direct feed —
   it always came from /users/{username} — so nothing is lost by
   the room going away.
--------------------------------------------------------- */

const API_BASE = "https://api.vpzone.tv/v1";

/* Only these hosts may end up in an img src. Copied deliberately
   rather than imported: this file must keep working after
   vpzoneTransform.js is deleted. */
const SAFE_ASSET =
  /^https:\/\/(?:[a-z0-9-]+\.)*(?:vpzone\.tv|supabase\.co)\/[^"'<>\s]*$/i;

const AVATAR_TTL_MS = 6 * 60 * 60 * 1000;   // 6h for a hit
const AVATAR_FAIL_TTL_MS = 10 * 60 * 1000;  // 10m for a miss
const MAX_AVATARS = 500;

function safeAsset(url) {
  return typeof url === "string" && SAFE_ASSET.test(url) ? url : null;
}

/**
 * Resolve a VPZONE avatar by username, with an LRU-ish cache.
 *
 * Requires VPZONE_API_KEY. Without it this returns null and
 * messages simply render without a picture — the integration
 * degrades rather than breaking, which is how the direct feed
 * behaved too.
 *
 * @param {string} username
 * @param {Map}    cache     owned by the caller, survives per-object
 * @param {object} env
 * @returns {Promise<string|null>}
 */
export async function resolveVpzoneAvatar(username, cache, env) {
  if (!env?.VPZONE_API_KEY) return null;
  if (!username || typeof username !== "string") return null;

  const key = username.toLowerCase();
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now < hit.expiresAt) return hit.url;

  /* Bounded. A long stream with many chatters would otherwise
     grow this map for the lifetime of the object. */
  if (cache.size >= MAX_AVATARS) {
    cache.delete(cache.keys().next().value);
  }

  let url = null;

  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(key)}`, {
      headers: {
        "Authorization": `Bearer ${env.VPZONE_API_KEY}`,
        "Accept": "application/json"
      },
      /* Short: this runs inline while relaying a message, so a
         slow lookup would delay chat. Better to render without
         a picture than to hold the message up. */
      signal: AbortSignal.timeout(2000)
    });

    if (res.ok) {
      const json = await res.json();
      url = safeAsset(json?.data?.avatar_url);
    } else {
      console.warn(`[VPZONE] avatar lookup ${key} -> ${res.status}`);
    }
  } catch (err) {
    console.warn(`[VPZONE] avatar lookup ${key} failed:`, String(err?.message || err));
  }

  /* Misses are cached too, on a shorter clock. Without this, a
     user with no avatar would be looked up on every single
     message they send. */
  cache.set(key, {
    url,
    expiresAt: now + (url ? AVATAR_TTL_MS : AVATAR_FAIL_TTL_MS)
  });

  return url;
}

/**
 * Beam sends senderId for VPZONE as the username, and also gives
 * us a profileUrl. Either will do; the id is cheaper.
 */
export function vpzoneUsernameFrom(payload) {
  if (typeof payload?.senderId === "string" && payload.senderId) {
    return payload.senderId;
  }

  const match = String(payload?.profileUrl || "").match(/\/u\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}
