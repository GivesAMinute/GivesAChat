// givesachat-cloudflare/src/kickAvatars.js

/* ---------------------------------------------------------
   Kick avatar lookup

   Beam relays Kick messages with senderMeta.avatarUrl set to
   null — it doesn't carry Kick profile pictures. Kick's public
   channel API does, needs no auth, and gives us:

     GET https://kick.com/api/v2/channels/<slug>
     -> user.profile_pic

   The slug comes from the profileUrl Beam already sends
   ("https://kick.com/givesaminute" -> "givesaminute").

   Every lookup is cached, including failures, because chat
   means the same handful of people talking repeatedly and
   Kick sits behind bot protection that may start refusing us.
   A miss costs one subrequest per user, then nothing.
--------------------------------------------------------- */

const KICK_API = "https://kick.com/api/v2/channels/";

/**
 * The API hands back the "fullsize" variant, which is far more
 * image than a 32px avatar needs. Kick serves the same asset at
 * several sizes — swap to "medium", as their own UI does.
 *
 * Left untouched if the URL doesn't follow that pattern, so an
 * unexpected shape still yields a working image.
 */
function preferMediumVariant(url) {
  return url.replace(/-fullsize(\.[a-z0-9]+)$/i, "-medium$1");
}

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;   // 24h
const FAILURE_TTL_MS = 10 * 60 * 1000;        // 10m — retry sooner
const LOOKUP_TIMEOUT_MS = 2000;               // don't stall the stream
const MAX_ENTRIES = 500;

/* ---------------------------------------------------------
   Diagnostic — reports every stage of a lookup so a failure
   can be located without reading logs. Exposed at
   /beam/kick-avatar?slug=<slug>
--------------------------------------------------------- */
export async function debugKickAvatar(slug) {
  const out = {
    slug,
    apiUrl: KICK_API + encodeURIComponent(slug),
    apiStatus: null,
    apiContentType: null,
    profilePicFromApi: null,
    resolvedUrl: null,
    imageStatus: null,
    imageContentType: null,
    error: null
  };

  try {
    const res = await fetch(out.apiUrl, {
      headers: { "Accept": "application/json" }
    });

    out.apiStatus = res.status;
    out.apiContentType = res.headers.get("content-type");

    if (!res.ok) {
      out.error = "Kick API refused the request";
      return out;
    }

    const json = await res.json();
    out.profilePicFromApi = json?.user?.profile_pic ?? null;

    if (!out.profilePicFromApi) {
      out.error = "API responded but carried no user.profile_pic";
      return out;
    }

    out.resolvedUrl = preferMediumVariant(out.profilePicFromApi);

    // Can the image itself actually be fetched?
    const img = await fetch(out.resolvedUrl, { method: "GET" });
    out.imageStatus = img.status;
    out.imageContentType = img.headers.get("content-type");

    if (!img.ok) out.error = "Avatar URL resolved but the image did not load";
  } catch (err) {
    out.error = String(err?.message || err);
  }

  return out;
}

export function slugFromKickProfileUrl(profileUrl) {
  if (typeof profileUrl !== "string") return null;

  const match = profileUrl.match(
    /^https?:\/\/(?:www\.)?kick\.com\/([A-Za-z0-9_-]+)\/?$/i
  );

  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {string} profileUrl  from senderMeta.profileUrl
 * @param {Map}    cache       caller-owned, survives between messages
 * @returns {Promise<string|null>} avatar URL, or null
 */
export async function resolveKickAvatar(profileUrl, cache) {
  const slug = slugFromKickProfileUrl(profileUrl);
  if (!slug) return null;

  const now = Date.now();
  const hit = cache.get(slug);

  if (hit && now < hit.expiresAt) return hit.url;

  // Keep the cache from growing without bound on a busy channel.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  let url = null;

  try {
    const res = await fetch(KICK_API + encodeURIComponent(slug), {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
    });

    if (res.ok) {
      const json = await res.json();
      const pic = json?.user?.profile_pic;

      if (typeof pic === "string" && /^https?:\/\//i.test(pic)) {
        url = preferMediumVariant(pic);
      }
    } else {
      console.warn(`[KICK] avatar lookup for ${slug} returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[KICK] avatar lookup for ${slug} failed:`, String(err?.message || err));
  }

  cache.set(slug, {
    url,
    expiresAt: now + (url ? SUCCESS_TTL_MS : FAILURE_TTL_MS)
  });

  return url;
}
