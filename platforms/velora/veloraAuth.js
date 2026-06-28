import axios from "axios";
import { loadStoredRefreshToken, storeRefreshToken } from "./veloraTokenStore.js";

let accessToken = null;
let refreshToken = null;
let refreshPromise = null;

export function initVeloraTokens() {
  // 1. Try persistent storage first
  const stored = loadStoredRefreshToken();
  if (stored) {
    refreshToken = stored;
    console.log("[VELORA] Loaded refresh token from file");
    return;
  }

  // 2. Fallback to Railway env (first-time only)
  refreshToken = process.env.VELORA_REFRESH_TOKEN || null;

  if (refreshToken) {
    console.log("[VELORA] Loaded refresh token from env");
  } else {
    console.warn("[VELORA] No refresh token found");
  }
}

export function getVeloraAccessToken() {
  return accessToken;
}

export async function refreshVeloraToken() {
  if (!refreshToken) {
    console.warn("[VELORA] No refresh token available");
    return null;
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    console.log("[VELORA] Refreshing Velora token…");

    try {
      const res = await axios.post(
        "https://api.velora.tv/api/developer/oauth/token",
        {
          grant_type: "refresh_token",
          client_id: process.env.VELORA_CLIENT_ID,
          client_secret: process.env.VELORA_CLIENT_SECRET,
          refresh_token: refreshToken
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          }
        }
      );

      accessToken = res.data.access_token;
      refreshToken = res.data.refresh_token;

      // ⭐ Persist the new refresh token
      storeRefreshToken(refreshToken);

      console.log("[VELORA] Token refresh successful");
      return accessToken;
    } catch (err) {
      console.error(
        "[VELORA] Failed to refresh token:",
        err?.response?.status,
        err?.response?.data || err.message
      );
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
