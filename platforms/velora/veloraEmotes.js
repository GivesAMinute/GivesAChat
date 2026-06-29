import fetch from "node-fetch";

let EMOTE_MAP = {};

export async function loadVeloraEmotes(channelId) {
  try {
    const globalRes = await fetch("https://api.velora.tv/api/emotes/global");
    const globalJson = await globalRes.json();

    const channelRes = await fetch(
      `https://api.velora.tv/api/emotes/channel/${channelId}`
    );
    const channelJson = await channelRes.json();

    const map = {};

    function addCollection(collection) {
      if (!collection?.emotes) return;

      for (const emote of collection.emotes) {
        const code = emote.code;
        const url =
          emote.assetVariants?.static2x ||
          emote.assetVariants?.static1x ||
          emote.assetVariants?.animated2x ||
          emote.assetVariants?.animated1x;

        if (code && url) {
          map[code] = url;
        }
      }
    }

    for (const col of globalJson.collections || []) addCollection(col);
    for (const col of channelJson.collections || []) addCollection(col);

    EMOTE_MAP = map;

    console.log("[VELORA] Loaded emotes:", Object.keys(EMOTE_MAP).length);
  } catch (err) {
    console.error("[VELORA] Failed to load emotes:", err);
  }
}

export function getVeloraEmoteUrl(code) {
  return EMOTE_MAP[code] || null;
}
