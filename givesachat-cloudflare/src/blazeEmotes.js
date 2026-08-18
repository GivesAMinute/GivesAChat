// givesachat-cloudflare/src/blazeEmotes.js

import { getBlazeAppToken } from "./blazeAuth.js";

/* ---------------------------------------------------------
   Blaze emotes

   Chat sends an emote as a token carrying the EMOTE ID:

     "emote test[emote:2f733d36-16bb-4a05-bb3f-1d7e73634a6e]"

   which is not the image filename. The same emote renders in
   Blaze's own client as

     cdn.blaze.stream/uploads/emote/8e447717-...-e9a6d5b02071.png

   — a different uuid entirely, so the URL cannot be built from
   the token. That is the whole reason emotes never rendered.

   Blaze published the resolving endpoints in Feb 2026:

     GET /v1/emotes/channels/{channelId}   channel + subscriber
     GET /v1/emotes/blaze                  global

   Both take the App Access Token we already mint for event
   subscriptions, need no extra OAuth scope, and return rows of
   { id, name, imageUrl, isPublic }. `id` is the uuid on the
   wire and `imageUrl` is the finished URL, so this is a direct
   lookup with nothing to construct.

   NOTE the docs' example rows show "uploads/emotes/<slug>.png",
   but real emotes are "uploads/emote/<uuid>.png" — singular,
   and uuid-named. The examples are illustrative. imageUrl is
   therefore used verbatim and never rebuilt from the id.
--------------------------------------------------------- */

const API = "https://api.blaze.stream/v1";

/* Emotes change when a streamer adds one, which is rare, but a
   stale map means a broken emote on stream. An hour is a
   reasonable middle. */
const TTL_MS = 60 * 60 * 1000;

/* Only this host may end up in an img src. imageUrl comes from
   an API response, so it is treated as untrusted input even
   though the API is authenticated. */
const CDN_HOST = /^https:\/\/cdn\.blaze\.stream\//i;

/* Module scope, so it survives between requests on a warm
   isolate. A cold start costs two API calls, which is cheap
   next to holding this in a durable object. */
let cache = null;

function usable(row) {
  return (
    row &&
    typeof row.id === "string" &&
    typeof row.imageUrl === "string" &&
    CDN_HOST.test(row.imageUrl)
  );
}

async function fetchList(env, token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "client-id": env.BLAZE_CLIENT_ID,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

/**
 * id -> { url, name, isPublic } for every emote the channel can
 * use: its own (public and subscriber-only) plus Blaze globals.
 *
 * @param {object} env
 * @param {boolean} force  bypass the cache
 */
export async function getBlazeEmoteMap(env, force = false) {
  if (!force && cache && Date.now() < cache.expiresAt) {
    return cache.map;
  }

  const channelId = env.BLAZE_CHANNEL_ID;
  if (!channelId) throw new Error("BLAZE_CHANNEL_ID not configured");

  const token = await getBlazeAppToken(env);

  /* Fetched together, but a failure of one must not lose the
     other — global emotes are still worth having if the channel
     call fails, and vice versa. */
  const [channel, global] = await Promise.allSettled([
    fetchList(env, token, `/emotes/channels/${encodeURIComponent(channelId)}`),
    fetchList(env, token, `/emotes/blaze`)
  ]);

  const map = {};
  let skipped = 0;

  /* Globals first so a channel emote of the same id wins. */
  for (const settled of [global, channel]) {
    if (settled.status === "rejected") {
      console.warn("[BLAZE] emote list failed:", String(settled.reason?.message || settled.reason));
      continue;
    }

    for (const row of settled.value) {
      if (!usable(row)) {
        skipped++;
        continue;
      }

      map[row.id] = {
        url: row.imageUrl,
        name: typeof row.name === "string" ? row.name : "",
        isPublic: row.isPublic !== false
      };
    }
  }

  if (skipped) {
    console.warn(`[BLAZE] skipped ${skipped} emote row(s) with a bad or off-CDN imageUrl`);
  }

  const count = Object.keys(map).length;

  /* An empty result is not cached. Caching it would blank every
     emote for an hour over one bad response. */
  if (count === 0) {
    console.warn("[BLAZE] emote map came back empty — not caching");
    return cache?.map || {};
  }

  console.log(`[BLAZE] emote map: ${count} emotes`);
  cache = { map, expiresAt: Date.now() + TTL_MS };

  return map;
}
