// givesachat-cloudflare/src/youtubeLiveChat.js

import { getYouTubeAccessToken } from "./youtubeAuth.js";
import { transformYouTubeMessage } from "./youtubeTransform.js";

// Simple in-memory rate limiter per Worker instance.
// YouTube quotas are strict; we enforce a minimum interval.
let lastPollTs = 0;

export async function fetchYouTubeLiveChat(env) {
  const now = Date.now();
  const minIntervalMs = 5000; // 5s between polls

  if (now - lastPollTs < minIntervalMs) {
    return {
      error: "Rate limited",
      retryAfterMs: minIntervalMs - (now - lastPollTs),
      messages: []
    };
  }

  lastPollTs = now;

  const accessToken = await getYouTubeAccessToken(env);
  if (!accessToken) {
    return { error: "No YouTube access token", messages: [] };
  }

  const liveChatId = env.YOUTUBE_LIVE_CHAT_ID;
  if (!liveChatId) {
    return { error: "Missing YOUTUBE_LIVE_CHAT_ID", messages: [] };
  }

  const apiUrl = new URL(
    "https://www.googleapis.com/youtube/v3/liveChat/messages"
  );
  apiUrl.searchParams.set("liveChatId", liveChatId);
  apiUrl.searchParams.set("part", "snippet,authorDetails");
  apiUrl.searchParams.set("maxResults", "50");

  const res = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    console.log("[YouTube] liveChat fetch failed", res.status, text);
    return { error: "YouTube API error", messages: [] };
  }

  const json = await res.json();
  const items = Array.isArray(json.items) ? json.items : [];

  const messages = items
    .map(transformYouTubeMessage)
    .filter(Boolean);

  return { error: null, messages };
}
