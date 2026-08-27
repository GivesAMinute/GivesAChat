// givesachat-cloudflare/src/blazeRoles.js

/* ---------------------------------------------------------
   Blaze OG role lookup

   Beam relays Blaze badges, but not all of them. Confirmed from
   a real relayed frame:

     badges=[{"type":"owner"},{"type":"moderator"},{"type":"vip"}]

   Three entries, no fourth under another name — OG simply is not
   in Beam's payload. Owner, moderator and VIP survive the relay;
   OG does not, so the flame badge vanished the moment Blaze moved
   from its own reader onto Beam.

   Blaze's own API still has it, and hands over the whole list in
   a single call:

     GET https://api.blaze.stream/v1/channels/roles/ogs
     -> data: [{ id, displayName, slug, avatarUrl }, ...]

   It accepts an App Access Token, which blazeAuth already mints
   from client credentials, so this needs no user OAuth and no new
   scope beyond users.read.

   Same shape as the Kick and VPZONE avatar resolvers: Beam leaves
   a gap, we fill it from the origin platform and cache the answer.

   The right long-term fix is for Beam to relay the OG badge like
   it relays the other three. This closes the gap in the meantime,
   and costs one request per half hour.
--------------------------------------------------------- */

import { getBlazeAppToken } from "./blazeAuth.js";

const API = "https://api.blaze.stream/v1";

/* A role list is not volatile — OG is granted deliberately and
   rarely. Half an hour means a newly-granted OG shows up within
   one stream, at two API calls an hour. */
const TTL_MS = 30 * 60 * 1000;

/* Failures are cached too, briefly. Without this, a Blaze outage
   would mean one failed request per chat message from a non-OG
   viewer, which is exactly when the channel is busiest. */
const ERROR_TTL_MS = 5 * 60 * 1000;

/**
 * Lowercased slugs AND display names of everyone holding the OG
 * role on the channel.
 *
 * Both are indexed because Beam relays a displayName while Blaze
 * keys on slug, and the two differ as soon as someone uses
 * capitals or a display name unlike their handle.
 *
 * @param {object} env
 * @param {{set: Set<string>, expiresAt: number}} cache  mutated in place
 * @returns {Promise<Set<string>>}  empty on failure, never throws
 */
export async function resolveBlazeOgs(env, cache) {
  const now = Date.now();

  if (cache.set && now < cache.expiresAt) return cache.set;

  if (!env.BLAZE_CLIENT_ID || !env.BLAZE_CLIENT_SECRET) {
    cache.set = new Set();
    cache.expiresAt = now + ERROR_TTL_MS;
    return cache.set;
  }

  try {
    const token = await getBlazeAppToken(env);

    /* channelId is required when authenticating as the app rather
       than as the channel owner — with an App Access Token there
       is no "authorized channel" for Blaze to infer. */
    const url =
      `${API}/channels/roles/ogs?channelId=${encodeURIComponent(env.BLAZE_CHANNEL_ID)}`;

    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "client-id": env.BLAZE_CLIENT_ID,
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];

    const set = new Set();
    for (const row of rows) {
      if (typeof row?.slug === "string") set.add(row.slug.toLowerCase());
      if (typeof row?.displayName === "string") {
        set.add(row.displayName.toLowerCase());
      }
    }

    cache.set = set;
    cache.expiresAt = now + TTL_MS;

    console.log(`[BLAZE] OG role list refreshed — ${rows.length} user(s)`);
    return set;
  } catch (err) {
    /* Never throws. A missing badge is a cosmetic loss; a throw
       here would happen mid-message and cost the message itself. */
    console.error("[BLAZE] OG role lookup failed:", err?.message || err);

    cache.set = cache.set || new Set();
    cache.expiresAt = now + ERROR_TTL_MS;
    return cache.set;
  }
}
