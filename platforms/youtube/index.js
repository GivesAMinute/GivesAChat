// platforms/youtube/index.js
import fetch from "node-fetch";
import { sanitizeHTML } from "../../public/overlay/chat/utils/sanitizeHTML.js";

const RETRY_DELAY = 10000;
const ERROR_DELAY = 5000;
const DEFAULT_POLL = 1500;

// Bypass domain + suffix
const YT_API_BASE = "https://content-googleapis-com.translate.goog/youtube/v3";
const YT_SUFFIX = "&_x_tr_sl=en&_x_tr_tl=en&_x_tr_hl=en&_x_tr_pto=wapp";

// Required headers to force JSON instead of HTML
const HEADERS = {
  "Accept": "application/json",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
};

export async function startYouTube(broadcast) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  if (!apiKey || !channelId) {
    console.log("[YouTube] Disabled: missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID");
    return;
  }

  console.log("[YouTube] Starting YouTube watcher…");
  watchForLiveChatId(broadcast, apiKey, channelId);
}

async function watchForLiveChatId(broadcast, apiKey, channelId) {
  try {
    const liveUrl =
      `${YT_API_BASE}/liveBroadcasts` +
      `?part=snippet,contentDetails,status` +
      `&broadcastStatus=active` +
      `&broadcastType=all` +
      `&channelId=${channelId}` +
      `&key=${apiKey}` +
      YT_SUFFIX;

    const liveData = await fetch(liveUrl, { headers: HEADERS }).then(r => r.json());
    const live = liveData?.items?.[0];
    const liveChatId = live?.snippet?.liveChatId;

    if (!liveChatId) {
      console.log("[YouTube] No active broadcast. Retrying in 10s…");
      return setTimeout(() => watchForLiveChatId(broadcast, apiKey, channelId), RETRY_DELAY);
    }

    console.log("[YouTube] liveChatId:", liveChatId);
    pollYouTubeChat(broadcast, apiKey, liveChatId);

  } catch (err) {
    console.error("[YouTube] Broadcast lookup failed:", err);
    setTimeout(() => watchForLiveChatId(broadcast, apiKey, channelId), ERROR_DELAY);
  }
}

async function pollYouTubeChat(broadcast, apiKey, liveChatId, nextPageToken = "") {
  try {
    const chatUrl =
      `${YT_API_BASE}/liveChat/messages` +
      `?liveChatId=${liveChatId}` +
      `&part=snippet,authorDetails` +
      `&key=${apiKey}` +
      (nextPageToken ? `&pageToken=${nextPageToken}` : "") +
      YT_SUFFIX;

    const data = await fetch(chatUrl, { headers: HEADERS }).then(r => r.json());

    if (data.error) {
      console.error("[YouTube] Chat error:", data.error);
      console.log("[YouTube] Restarting broadcast watcher in 10s…");
      return setTimeout(() => startYouTube(broadcast), RETRY_DELAY);
    }

    nextPageToken = data.nextPageToken || "";

    if (data.items) {
      for (const item of data.items) {
        const user = item.authorDetails;
        const snippet = item.snippet;

        broadcast({
          type: "chat",
          platform: "youtube",
          username: user.displayName,
          avatar: user.profileImageUrl,
          html: sanitizeHTML(snippet.displayMessage)
        });
      }
    }

    const delay = data.pollingIntervalMillis || DEFAULT_POLL;
    setTimeout(() => pollYouTubeChat(broadcast, apiKey, liveChatId, nextPageToken), delay);

  } catch (err) {
    console.error("[YouTube] Poll error:", err);
    setTimeout(() => pollYouTubeChat(broadcast, apiKey, liveChatId, nextPageToken), ERROR_DELAY);
  }
}
