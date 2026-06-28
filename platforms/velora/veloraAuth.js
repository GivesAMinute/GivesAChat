// platforms/velora/veloraAuth.js
import axios from "axios";
import { saveRefreshToken } from "./veloraTokenStore.js";

export async function refreshVeloraToken(refreshToken) {
  try {
    console.log("[VELORA] Refreshing Velora token…");

    const res = await axios.post("https://api.velora.live/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.VELORA_CLIENT_ID
    });

    const newRefresh = res.data.refresh_token;
    saveRefreshToken(newRefresh);

    console.log("[VELORA] Token refreshed successfully");
    return res.data.access_token;

  } catch (err) {
    console.log("[VELORA] Failed to refresh token:", err.response?.data || err);
    return null;
  }
}
