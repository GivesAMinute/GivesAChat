// platforms/youtube/index.js
import fetch from "node-fetch";
import { sanitizeNodeHTML as sanitizeHTML } from "./sanitizeNodeHTML.js";

const BROADCAST_CHECK_INTERVAL = 60_000; // 1 minute
const POLL_MIN_INTERVAL = 5000;          // 5 seconds
const ERROR_DELAY = 5000;
const QUOTA_BACKOFF = 300_000;           // 5 minutes

// In-memory access token cache
let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

/**
 * Exchanges your refresh token for a short-lived access token.
 * Uses caching to avoid hammering Google's token endpoint.
 */
async function getAccessToken() {
  const now = Date.now();

  if (cachedAccessToken && now < cachedAccessTokenExpiry - 60_000) {
    return cachedAccessToken;
  }

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

  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;

  return cachedAccessToken;
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

      if (data?.error?.code === 403) {
        console.log("[YouTube] Quota exceeded. Backing off for 5 minutes…");
        return setTimeout(
          () => watchForLiveChatId(broadcast, channelId),
          QUOTA_BACKOFF
        );
      }

      return setTimeout(
        () => watchForLiveChatId(broadcast, channelId),
        ERROR_DELAY
      );
    }

    const live = data.items?.[0];
    const liveChatId = live?.snippet?.liveChatId;

    if (!liveChatId) {
      console.log("[YouTube] No active broadcast. Checking again in 1 minute…");
      return setTimeout(
        () => watchForLiveChatId(broadcast, channelId),
        BROADCAST_CHECK_INTERVAL
      );
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

      if (data?.error?.code === 403) {
        console.log("[YouTube] Chat quota exceeded. Backing off for 5 minutes…");
        return setTimeout(
          () => pollYouTubeChat(broadcast, liveChatId, nextPageToken),
          QUOTA_BACKOFF
        );
      }

      return setTimeout(
        () => pollYouTubeChat(broadcast, liveChatId, nextPageToken),
        ERROR_DELAY
      );
    }

    nextPageToken = data.nextPageToken || nextPageToken;

    if (data.items) {
      for (const item of data.items) {
        const user = item.authorDetails;
        const snippet = item.snippet;

        let username = user.displayName || "";
        if (username.startsWith("@")) {
          username = username.substring(1);
        }

        broadcast({
          type: "chat",
          platform: "youtube",
          username,
          avatar: user.profileImageUrl,
          html: sanitizeHTML(snippet.displayMessage || "")
        });
      }
    }

    const rawDelay = data.pollingIntervalMillis || POLL_MIN_INTERVAL;
    const delay = Math.max(rawDelay, POLL_MIN_INTERVAL);

    setTimeout(
      () => pollYouTubeChat(broadcast, liveChatId, nextPageToken),
      delay
    );

  } catch (err) {
    console.error("[YouTube] Poll error:", err);
    setTimeout(
      () => pollYouTubeChat(broadcast, liveChatId, nextPageToken),
      ERROR_DELAY
    );
  }
}
