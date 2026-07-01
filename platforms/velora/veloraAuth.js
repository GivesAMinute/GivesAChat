// platforms/velora/veloraAuth.js
import axios from "axios";

/**
 * Velora Bot Authentication (Client Credentials OAuth)
 *
 * Bots DO NOT use refresh tokens or PKCE.
 * Bots authenticate using:
 *
 *   grant_type = "client_credentials"
 *
 * Velora returns ONLY:
 *   - access_token
 *   - expires_in (seconds)
 *
 * No refresh_token is ever returned.
 *
 * We simply request a new access token every hour.
 */

let cachedAccessToken = null;
let tokenExpiry = 0; // unix timestamp (ms)

/**
 * Request a new Velora access token using Client Credentials OAuth.
 */
async function requestNewAccessToken() {
  try {
    console.log("[VELORA] Requesting new access token…");

    const res = await axios.post(
      "https://api.velora.tv/api/developer/oauth/token",
      {
        grant_type: "client_credentials",
        client_id: process.env.VELORA_CLIENT_ID,
        client_secret: process.env.VELORA_CLIENT_SECRET,
        scope: "user:read stream:read chat:read chat:write chat:moderate"
      }
    );

    const accessToken = res.data.access_token;
    const expiresIn = res.data.expires_in; // seconds

    if (!accessToken) {
      console.log("[VELORA] ERROR: No access_token returned!");
      return null;
    }

    // Cache token + expiry
    cachedAccessToken = accessToken;
    tokenExpiry = Date.now() + expiresIn * 1000;

    console.log("[VELORA] Access token acquired (valid for " + expiresIn + "s)");
    return cachedAccessToken;

  } catch (err) {
    console.log("[VELORA] Failed to request access token:", err.response?.data || err);
    return null;
  }
}

/**
 * Get a valid Velora access token.
 * Refresh automatically when expired or missing.
 */
export async function getVeloraAccessToken() {
  const now = Date.now();

  // If token missing or expired, request a new one
  if (!cachedAccessToken || now >= tokenExpiry) {
    return await requestNewAccessToken();
  }

  return cachedAccessToken;
}
