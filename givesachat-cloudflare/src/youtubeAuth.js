// givesachat-cloudflare/src/youtubeAuth.js

// Uses a long-lived refresh token to get short-lived access tokens.
// You must set these in your Cloudflare env:
// - YOUTUBE_CLIENT_ID
// - YOUTUBE_CLIENT_SECRET
// - YOUTUBE_REFRESH_TOKEN

export async function getYouTubeAccessToken(env) {
  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.log("[YouTube] Missing OAuth env vars");
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    console.log("[YouTube] Token refresh failed", res.status);
    return null;
  }

  const json = await res.json();
  return json.access_token || null;
}
