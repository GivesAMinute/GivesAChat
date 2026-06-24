// platforms/blaze/blazeAuth.js
import axios from "axios";

// Load from env on startup into globals
globalThis.blazeAccessToken = process.env.BLAZE_ACCESS_TOKEN || null;
globalThis.blazeRefreshToken = process.env.BLAZE_REFRESH_TOKEN || null;

export function getBlazeAccessToken() {
  return globalThis.blazeAccessToken;
}

export function getBlazeRefreshToken() {
  return globalThis.blazeRefreshToken;
}

export async function refreshBlazeToken() {
  try {
    console.log("🔄 Refreshing Blaze token...");

    const res = await axios.post(
      "https://blaze.stream/bapi/oauth2/refresh",
      {
        clientId: process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        refreshToken: getBlazeRefreshToken()
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    const { accessToken: newAccess, refreshToken: newRefresh } = res.data;

    // Update globals
    globalThis.blazeAccessToken = newAccess;
    globalThis.blazeRefreshToken = newRefresh;

    // Update in-memory env (so anything else reading process.env sees the latest)
    process.env.BLAZE_ACCESS_TOKEN = newAccess;
    process.env.BLAZE_REFRESH_TOKEN = newRefresh;

    console.log("🔥 Blaze token refreshed successfully");

    return newAccess;
  } catch (err) {
    console.error("❌ Failed to refresh Blaze token:", err.response?.data || err);
    throw err;
  }
}
