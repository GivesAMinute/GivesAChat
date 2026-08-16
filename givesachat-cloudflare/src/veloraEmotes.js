// givesachat-cloudflare/src/veloraEmotes.js

import { getVeloraAccessToken } from "./veloraAuth.js";

const emoteDict = new Map();
let emotesLoaded = false;

const VELORA_CHANNEL_USERNAME = "GivesAMinute";

async function loadVeloraEmotes(env) {
  if (emotesLoaded) return;
  emotesLoaded = true;

  const token = await getVeloraAccessToken(env);
  if (!token) {
    console.error("[VELORA] Cannot load emotes — no access token");
    return;
  }

  try {
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": "GivesAChat/CloudflareWorker",
      "Connection": "keep-alive"
    };

    /* Three sources, merged.

       /api/emotes is a distinct route from the two below and
       returns the collections available to the authenticated
       viewer (it carries isLocked / accessible / viewerTier).
       Fetching all three and merging costs one extra request
       and can only widen coverage — a code we can resolve from
       any source is better than a code rendered as raw text. */
    const [allRes, globalRes, channelRes] = await Promise.all([
      fetch("https://api.velora.tv/api/emotes", { method: "GET", headers }),
      fetch("https://api.velora.tv/api/emotes/global", { method: "GET", headers }),
      fetch(
        `https://api.velora.tv/api/emotes/channel/${VELORA_CHANNEL_USERNAME}`,
        { method: "GET", headers }
      )
    ]);

    // SAFE LOGS — these will NOT crash Cloudflare
    console.log("[VELORA] Global fetch status:", globalRes.status);
    console.log("[VELORA] Channel fetch status:", channelRes.status);

    const allJson = allRes.ok ? await allRes.json() : null;
    const globalJson = await globalRes.json();
    const channelJson = await channelRes.json();

    console.log(
      "[VELORA] Global collections:",
      Array.isArray(globalJson?.collections) ? globalJson.collections.length : "none"
    );
    console.log(
      "[VELORA] Channel collections:",
      Array.isArray(channelJson?.collections) ? channelJson.collections.length : "none"
    );

    const all = [];

    function collectFrom(json) {
      if (!json) return;

      if (!Array.isArray(json.collections)) {
        console.warn("[VELORA] No collections in response");
        return;
      }

      for (const collection of json.collections) {
        if (!Array.isArray(collection.emotes)) continue;

        for (const emote of collection.emotes) {
          const code = emote.code;
          const url =
            emote.assetVariants?.static2x ||
            emote.assetVariants?.static1x ||
            null;

          if (!code || !url) continue;
          all.push({ code, url });
        }
      }
    }

    collectFrom(allJson);
    collectFrom(globalJson);
    collectFrom(channelJson);

    for (const { code, url } of all) {
      emoteDict.set(code, url);
    }

    console.log(`[VELORA] Loaded ${emoteDict.size} emotes`);
  } catch (err) {
    console.error("[VELORA] Emote preload error:", err);
  }
}

export async function applyVeloraEmotes(message, env) {
  if (!message) return "";

  await loadVeloraEmotes(env);

  const tokens = message.split(/(\s+)/);

  const out = tokens.map((token) => {
    const trimmed = token.trim();
    if (!trimmed) return token;

    const url = emoteDict.get(trimmed);

    if (!url) {
      /* Codes look like :Name: or CamelCase words. Only warn on
         things plausibly meant as emotes, so ordinary chat text
         doesn't fill the log. Anything appearing here is an
         emote we could not resolve — most likely from a channel
         whose collection we don't load. */
      if (/^:[A-Za-z0-9_]+:$/.test(trimmed)) {
        console.warn("[VELORA] unresolved emote code:", trimmed);
      }
      return token;
    }

    return `<img class="velora-emote" src="${url}" alt="${trimmed}" />`;
  });

  return out.join("");
}

/* ---------------------------------------------------------
   Endpoint discovery (diagnostic)

   Two known gaps, both reported live:

   BADGES — badges/velora/index.js only knows six hardcoded
   ids and silently ignores the rest, so anything from Velora's
   wider catalog never renders. pride-month-2026 is hardcoded
   with a CDN url, which tells us catalog badges live at
   assets.velora.tv/badges/catalog/<id>/static-<uuid>.png —
   and that uuid can't be derived, so a catalog endpoint is
   needed.

   EMOTES — we load global + our own channel only. A viewer
   subscribed to another channel using THEIR emotes resolves
   to nothing. Jim mentions /api/emotes returning requiredTier,
   isLocked and accessible, implying a fuller catalog exists.

   Exposed at /velora/probe. Delete once both are resolved.
--------------------------------------------------------- */
const VELORA_PROBE_PATHS = [
  "/api/emotes",
  "/api/emotes/all",
  "/api/emotes/catalog",
  "/api/emotes/global",
  `/api/emotes/channel/${VELORA_CHANNEL_USERNAME}`,
  "/api/badges",
  "/api/badges/catalog",
  "/api/badges/global",

  // control — must not exist
  "/api/zzz-control-does-not-exist"
];

export async function probeVeloraEndpoints(env, extraPath = null) {
  const token = await getVeloraAccessToken(env);
  if (!token) return [{ error: "no Velora access token stored" }];

  const paths = extraPath ? [extraPath, ...VELORA_PROBE_PATHS] : VELORA_PROBE_PATHS;
  const results = [];

  for (const path of paths) {
    try {
      const res = await fetch(`https://api.velora.tv${path}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });

      const body = await res.text();

      results.push({
        path,
        status: res.status,
        // Enough to see the shape without dumping a full catalog
        body: body.slice(0, 600)
      });
    } catch (err) {
      results.push({ path, error: String(err?.message || err) });
    }
  }

  return results;
}
