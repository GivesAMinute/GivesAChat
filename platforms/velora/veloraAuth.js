import axios from "axios";

let accessToken = null;
let refreshToken = null;

export function initVeloraTokens() {
  accessToken = process.env.VELORA_ACCESS_TOKEN || null;
  refreshToken = process.env.VELORA_REFRESH_TOKEN || null;

  if (refreshToken) {
    console.log("[VELORA] Loaded refresh token from env");
  } else {
    console.warn("[VELORA] No refresh token found in env");
  }
}

export function getVeloraAccessToken() {
  return accessToken;
}

export function getVeloraRefreshToken() {
  return refreshToken;
}

export async function refreshVeloraToken() {
  if (!refreshToken) {
    console.warn("[VELORA] No refresh token available");
    return null;
  }

  console.log("[VELORA] Refreshing Velora token…");

  try {
    const res = await axios.post(
      "https://api.velora.tv/api/developer/oauth/token",
      {
        grant_type: "refresh_token",
        client_id: process.env.VELORA_CLIENT_ID,
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

    console.log("[VELORA] Token refresh successful");
    return accessToken;
  } catch (err) {
    console.error(
      "[VELORA] Failed to refresh token:",
      err?.response?.status,
      err?.response?.data || err.message
    );
    return null;
  }
}
