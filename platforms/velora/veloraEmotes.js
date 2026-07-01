// platforms/velora/veloraEmotes.js
import axios from "axios";
import { getVeloraAccessToken } from "./veloraAuth.js";

/* ---------------------------------------------------------
   ⭐ Emote Cache (in-memory)
--------------------------------------------------------- */
const emoteCache = new Map();

/* ---------------------------------------------------------
   ⭐ Extract emote codes from message
   Velora emotes use :CodeName: format
--------------------------------------------------------- */
export function extractVeloraEmoteCodes(message) {
  if (!message) return [];

  // Match :EmoteCode: patterns
  const matches = message.match(/:[A-Za-z0-9_]+:/g);
  if (!matches) return [];

  // Remove surrounding colons → :poggers: → poggers
  return matches.map((m) => m.replace(/:/g, ""));
}

/* ---------------------------------------------------------
   ⭐ Resolve emote codes → URLs (with caching)
--------------------------------------------------------- */
export async function resolveVeloraEmotes(codes) {
  if (!codes || codes.length === 0) return {};

  // Only request codes not already cached
  const uncached = codes.filter((c) => !emoteCache.has(c));

  if (uncached.length > 0) {
    const token = await getVeloraAccessToken();
    if (!token) {
      console.error("[VELORA] Cannot resolve emotes — no access token");
      return {};
    }

    try {
      const url = `https://api.velora.tv/api/emotes/resolve?codes=${uncached.join(",")}`;

      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Store resolved URLs in cache
      Object.entries(res.data).forEach(([code, url]) => {
        emoteCache.set(code, url);
      });
    } catch (err) {
      console.error("[VELORA] Emote resolve error:", err.response?.data || err);
    }
  }

  // Build final result from cache
  const result = {};
  codes.forEach((c) => {
    if (emoteCache.has(c)) result[c] = emoteCache.get(c);
  });

  return result;
}

/* ---------------------------------------------------------
   ⭐ Replace emote codes with <img> tags
--------------------------------------------------------- */
export async function applyVeloraEmotes(message) {
  if (!message) return "";

  const codes = extractVeloraEmoteCodes(message);
  if (codes.length === 0) return message;

  const resolved = await resolveVeloraEmotes(codes);

  let html = message;

  for (const [code, url] of Object.entries(resolved)) {
    const imgTag = `<img class="velora-emote" src="${url}" alt=":${code}:" />`;

    // Replace all occurrences of :code:
    html = html.replace(new RegExp(`:${code}:`, "g"), imgTag);
  }

  return html;
}
