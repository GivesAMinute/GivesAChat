// platforms/youtube/index.js
import fetch from "node-fetch";
import { sanitizeHTML } from "../../public/overlay/chat/utils/sanitizeHTML.js";

const RETRY_DELAY = 10000;
const ERROR_DELAY = 5000;
const DEFAULT_POLL = 1500;

export async function startYouTube(broadcast) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const proxyUrl = process.env.YOUTUBE_PROXY_URL;

  if (!apiKey || !channelId || !proxyUrl) {
    console.log("[YouTube] Disabled: missing YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID, or YOUTUBE_PROXY_URL");
    return;
  }

  console.log("[YouTube] Starting YouTube watcher…");
  watchForLiveChatId(broadcast, apiKey, channelId, proxyUrl);
}

async function watchForLiveChatId(broadcast, apiKey, channelId, proxyUrl) {
  try {
    const googleUrl =
      `https://www.googleapis.com/youtube/v3/liveBroadcasts` +
      `?part=snippet,contentDetails,status` +
      `&broadcastStatus=active` +
      `&broadcastType=all` +
      `&channelId=${channelId}` +
      `&key=${apiKey}`;

    const encoded = encodeURIComponent(googleUrl);
    const workerUrl = `${proxyUrl}/?url=${encoded}`;

    const liveData = await fetch(workerUrl).then(r => r.json());
    const live = liveData?.items?.[0];
    const liveChatId = live?.snippet?.liveChatId;

    if (!liveChatId) {
      console.log("[YouTube] No active broadcast. Retrying in 10s…");
      return setTimeout(() => watchForLiveChatId(broadcast, apiKey, channelId, proxyUrl), RETRY_DELAY);
    }

    console.log("[YouTube] liveChatId:", liveChatId);
    pollYouTubeChat(broadcast, apiKey, liveChatId, proxyUrl);

  } catch (err) {
    console.error("[YouTube] Broadcast lookup failed:", err);
    setTimeout(() => watchForLiveChatId(broadcast, apiKey, channelId, proxyUrl), ERROR_DELAY);
  }
}

async function pollYouTubeChat(broadcast, apiKey, liveChatId, proxyUrl, nextPageToken = "") {
  try {
    const googleUrl =
      `https://www.googleapis.com/youtube/v3/liveChat/messages` +
      `?liveChatId=${liveChatId}` +
      `&part=snippet,authorDetails` +
      `&key=${apiKey}` +
      (nextPageToken ? `&pageToken=${nextPageToken}` : "");

    const encoded = encodeURIComponent(googleUrl);
    const workerUrl = `${proxyUrl}/?url=${encoded}`;

    const data = await fetch(workerUrl).then(r => r.json());

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
    setTimeout(() => pollYouTubeChat(broadcast, apiKey, liveChatId, proxyUrl, nextPageToken), delay);

  } catch (err) {
    console.error("[YouTube] Poll error:", err);
    setTimeout(() => pollYouTubeChat(broadcast, apiKey, liveChatId, proxyUrl, nextPageToken), ERROR_DELAY);
  }
}
