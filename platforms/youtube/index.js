// platforms/youtube/index.js
import fetch from "node-fetch";
import { sanitizeNodeHTML as sanitizeHTML } from "./sanitizeNodeHTML.js";

const RETRY_DELAY = 10000;
const ERROR_DELAY = 5000;
const DEFAULT_POLL = 1500;

/**
 * Exchanges your refresh token for a short-lived access token.
 */
async function getAccessToken() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("[YouTube] Missing OAuth environment variables");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("[YouTube] Token refresh failed:", data);
    throw new Error("YouTube token refresh failed");
  }

  return data.access_token;
}

/**
 * Entry point called by your backend.
 */
export async function startYouTube(broadcast) {
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  if (!channelId) {
    console.log("[YouTube] Disabled: missing YOUTUBE_CHANNEL_ID");
    return;
  }

  console.log("[YouTube] Starting YouTube watcher…");
  watchForLiveChatId(broadcast, channelId);
}

/**
 * Continuously checks for an active broadcast until one appears.
 */
async function watchForLiveChatId(broadcast, channelId) {
  try {
    const accessToken = await getAccessToken();

    const url =
      "https://www.googleapis.com/youtube/v3/liveBroadcasts" +
      "?part=snippet,contentDetails,status" +
      "&broadcastStatus=active" +
      "&broadcastType=all" +
      `&channelId=${channelId}`;

    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json"
      }
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[YouTube] liveBroadcasts error:", data);
      return setTimeout(() => watchForLiveChatId(broadcast, channelId), ERROR_DELAY);
    }

    const live = data.items?.[0];
    const liveChatId = live?.snippet?.liveChatId;

    if (!liveChatId) {
      console.log("[YouTube] No active broadcast. Retrying in 10s…");
      return setTimeout(() => watchForLiveChatId(broadcast, channelId), RETRY_DELAY);
    }

    console.log("[YouTube] liveChatId:", liveChatId);
    pollYouTubeChat(broadcast, liveChatId);

  } catch (err) {
    console.error("[YouTube] Broadcast lookup failed:", err);
    setTimeout(() => watchForLiveChatId(broadcast, channelId), ERROR_DELAY);
  }
}

/**
 * Polls YouTube live chat forever.
 */
async function pollYouTubeChat(broadcast, liveChatId, nextPageToken = "") {
  try {
    const accessToken = await getAccessToken();

    const url =
      "https://www.googleapis.com/youtube/v3/liveChat/messages" +
      `?liveChatId=${liveChatId}` +
      "&part=snippet,authorDetails" +
      (nextPageToken ? `&pageToken=${nextPageToken}` : "");

    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json"
      }
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[YouTube] Chat error:", data);
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
    setTimeout(() => pollYouTubeChat(broadcast, liveChatId, nextPageToken), delay);

  } catch (err) {
    console.error("[YouTube] Poll error:", err);
    setTimeout(() => pollYouTubeChat(broadcast, liveChatId, nextPageToken), ERROR_DELAY);
  }
}
