// backend/blaze/blazeAuth.js
import axios from "axios";

export async function refreshBlazeToken() {
  try {
    const res = await axios.post(
      "https://blaze.stream/bapi/oauth2/refresh",
      {
        clientId: process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        refreshToken: globalThis.blazeRefreshToken || process.env.BLAZE_REFRESH_TOKEN
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    const { accessToken, refreshToken } = res.data;

    globalThis.blazeAccessToken = accessToken;
    globalThis.blazeRefreshToken = refreshToken;

    console.log("🔥 Blaze token refreshed");

    return accessToken;
  } catch (err) {
    console.error("❌ Failed to refresh Blaze token:", err.response?.data || err);
    throw err;
  }
}
