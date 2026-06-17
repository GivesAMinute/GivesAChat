import axios from "axios";

export async function refreshBlazeToken() {
  try {
    const res = await axios.post(
      "https://blaze.stream/bapi/oauth2/refresh",
      {
        clientId: process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        refreshToken: process.env.BLAZE_REFRESH_TOKEN
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    const { accessToken, refreshToken } = res.data;

    // Update environment variables in memory
    process.env.BLAZE_ACCESS_TOKEN = accessToken;
    process.env.BLAZE_REFRESH_TOKEN = refreshToken;

    console.log("🔥 Blaze token refreshed");

    return accessToken;
  } catch (err) {
    console.error("❌ Failed to refresh Blaze token:", err.response?.data || err);
    throw err;
  }
}
