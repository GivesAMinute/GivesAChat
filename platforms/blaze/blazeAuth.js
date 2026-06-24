// backend/blaze/blazeAuth.js
import axios from "axios";

let accessToken = process.env.BLAZE_ACCESS_TOKEN;
let refreshToken = process.env.BLAZE_REFRESH_TOKEN;

export function getBlazeAccessToken() {
  return globalThis.blazeAccessToken || accessToken;
}

export function getBlazeRefreshToken() {
  return globalThis.blazeRefreshToken || refreshToken;
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

    console.log("🔥 Blaze token refreshed successfully");

    return newAccess;
  } catch (err) {
    console.error("❌ Failed to refresh Blaze token:", err.response?.data || err);
    throw err;
  }
}
