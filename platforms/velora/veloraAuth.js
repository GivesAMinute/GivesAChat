// platforms/velora/veloraAuth.js
import axios from "axios";
import { saveRefreshToken } from "./veloraTokenStore.js";

/**
 * Refresh the Velora token using the refresh token.
 * Saves the new refresh token to disk.
 *
 * Correct endpoint:
 *   https://api.velora.tv/oauth/token
 *
 * PKCE rules:
 * - No client_secret
 * - Only client_id + refresh_token
 * - No auto-refresh on startup (your platform code calls this manually)
 */
export async function refreshVeloraToken(refreshToken) {
  try {
    console.log("[VELORA] Refreshing Velora token…");

    const res = await axios.post("https://api.velora.tv/oauth/token", {
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

/**
 * Legacy compatibility for veloraChatSocket.js
 * Your socket code still imports this, so we provide a harmless stub.
 *
 * The new Velora flow passes access tokens directly into the socket,
 * so this function no longer needs to return anything meaningful.
 */
export function getVeloraAccessToken() {
  return null;
}
