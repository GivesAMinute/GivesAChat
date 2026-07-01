// platforms/velora/veloraEmotes.js
import axios from "axios";
import { getVeloraAccessToken } from "./veloraAuth.js";

/* ---------------------------------------------------------
   ⭐ Emote dictionary (in-memory)
--------------------------------------------------------- */
const emoteDict = new Map();
let emotesLoaded = false;

/* ---------------------------------------------------------
   ⭐ Load global + channel emotes once
--------------------------------------------------------- */
async function loadVeloraEmotes() {
  if (emotesLoaded) return;
  emotesLoaded = true;

  const token = await getVeloraAccessToken();
  if (!token) {
    console.error("[VELORA] Cannot load emotes — no access token");
    return;
  }

  try {
    const headers = { Authorization: `Bearer ${token}` };

    // Global emotes
    const globalRes = await axios.get(
      "https://api.velora.tv/api/emotes/global",
      { headers }
    );

    // Channel emotes (GivesAMinute)
    const channelRes = await axios.get(
      "https://api.velora.tv/api/emotes/channel/GivesAMinute",
      { headers }
    );

    const all = []
      .concat(globalRes.data?.emotes || globalRes.data || [])
      .concat(channelRes.data?.emotes || channelRes.data || []);

    for (const emote of all) {
      const code = emote.code || emote.name || emote.slug;
      const url =
        emote.staticAssetUrl ||
        emote.url ||
        emote.imageUrl ||
        emote.assetUrl;

      if (!code || !url) continue;
      emoteDict.set(code, url);
    }

    console.log(
      `[VELORA] Loaded ${emoteDict.size} emotes (global + channel)`
    );
  } catch (err) {
    console.error("[VELORA] Emote preload error:", err.response?.data || err);
  }
}

/* ---------------------------------------------------------
   ⭐ Apply emotes to a plain-text message
   Matches bare words against known emote codes
--------------------------------------------------------- */
export async function applyVeloraEmotes(message) {
  if (!message) return "";

  await loadVeloraEmotes();

  const tokens = message.split(/(\s+)/); // keep spaces
  const out = tokens.map((token) => {
    const trimmed = token.trim();
    if (!trimmed) return token;

    const url = emoteDict.get(trimmed);
    if (!url) return token;

    return `<img class="velora-emote" src="${url}" alt="${trimmed}" />`;
  });

  return out.join("");
}
