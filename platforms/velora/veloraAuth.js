// platforms/velora/veloraAuth.js
import axios from "axios";
import { saveRefreshToken } from "./veloraTokenStore.js";

/**
 * Refresh the Velora token using the refresh token.
 * Uses the correct Developer OAuth endpoint:
 *
 *   https://velora.tv/api/developer/oauth/token
 *
 * Developer OAuth requires:
 * - client_id
 * - client_secret
 * - refresh_token
 */
export async function refreshVeloraToken(refreshToken) {
  try {
    console.log("[VELORA] Refreshing Velora token…");

    const res = await axios.post(
      "https://velora.tv/api/developer/oauth/token",
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.VELORA_CLIENT_ID,
        client_secret: process.env.VELORA_CLIENT_SECRET
      }
    );

    // Velora rotates refresh tokens — always save the new one
    const newRefresh = res.data.refresh_token;
    if (newRefresh) {
      saveRefreshToken(newRefresh);
    }

    console.log("[VELORA] Token refreshed successfully");
    return res.data.access_token;

  } catch (err) {
    console.log("[VELORA] Failed to refresh token:", err.response?.data || err);
    return null;
  }
}

/**
 * Legacy compatibility for veloraChatSocket.js
 */
export function getVeloraAccessToken() {
  return null;
}
