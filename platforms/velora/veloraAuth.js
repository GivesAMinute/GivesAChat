// platforms/velora/veloraAuth.js
import axios from "axios";
import fs from "fs";
import path from "path";

const TOKENS_PATH = path.resolve("./velora_tokens.json");

let accessToken = null;
let refreshToken = null;

function loadTokensFromDisk() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      const raw = fs.readFileSync(TOKENS_PATH, "utf8");
      const parsed = JSON.parse(raw);

      accessToken = parsed.accessToken || null;
      refreshToken = parsed.refreshToken || null;

      console.log("[VELORA] Loaded tokens from disk");
      return;
    }
  } catch (err) {
    console.error("[VELORA] Failed to load tokens:", err.message);
  }

  accessToken = process.env.VELORA_ACCESS_TOKEN || null;
  refreshToken = process.env.VELORA_REFRESH_TOKEN || null;

  if (accessToken || refreshToken) {
    console.log("[VELORA] Loaded tokens from env (initial run)");
  }
}

function saveTokensToDisk() {
  try {
    fs.writeFileSync(
      TOKENS_PATH,
      JSON.stringify({ accessToken, refreshToken }, null, 2),
      "utf8"
    );
    console.log("[VELORA] Saved tokens to disk");
  } catch (err) {
    console.error("[VELORA] Failed to save tokens:", err.message);
  }
}

export function initVeloraTokens() {
  loadTokensFromDisk();
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

    saveTokensToDisk();

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
