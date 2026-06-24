// platforms/youtube/index.js
import fetch from "node-fetch";

export async function startYouTube(broadcast) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  if (!apiKey || !channelId) {
    console.log("YouTube disabled: missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID");
    return;
  }

  console.log("[YouTube] Starting chat ingestion…");

  const liveUrl =
    `https://www.googleapis.com/youtube/v3/liveBroadcasts` +
    `?part=snippet,contentDetails,status` +
    `&broadcastStatus=active` +
    `&broadcastType=all` +
    `&channelId=${channelId}` +
    `&key=${apiKey}`;

  const liveData = await fetch(liveUrl).then(r => r.json()).catch(() => null);

  const live = liveData?.items?.[0];
  const liveChatId = live?.snippet?.liveChatId;

  if (!liveChatId) {
    console.log("[YouTube] No active live broadcast.");
    return;
  }

  console.log("[YouTube] liveChatId:", liveChatId);

  let nextPageToken = "";

  async function poll() {
    try {
      const chatUrl =
        `https://www.googleapis.com/youtube/v3/liveChat/messages` +
        `?liveChatId=${liveChatId}` +
        `&part=snippet,authorDetails` +
        `&key=${apiKey}` +
        (nextPageToken ? `&pageToken=${nextPageToken}` : "");

      const data = await fetch(chatUrl).then(r => r.json());

      nextPageToken = data.nextPageToken || "";

      if (data.items) {
        for (const item of data.items) {
          const user = item.authorDetails;
          const snippet = item.snippet;

          broadcast({
            platform: "youtube",
            username: user.displayName,
            avatar: user.profileImageUrl,
            html: snippet.displayMessage
          });
        }
      }

      const delay = data.pollingIntervalMillis || 1500;
      setTimeout(poll, delay);
    } catch {
      setTimeout(poll, 5000);
    }
  }

  poll();
}
