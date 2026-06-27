// platforms/blaze/blazeAuth.js
import axios from "axios";
import fs from "fs";
import path from "path";

const TOKENS_PATH = path.resolve("./blaze_tokens.json");

let accessToken = null;
let refreshToken = null;

// Load tokens from JSON file or env on startup
function loadTokensFromDisk() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      const raw = fs.readFileSync(TOKENS_PATH, "utf8");
      const parsed = JSON.parse(raw);

      accessToken = parsed.accessToken || null;
      refreshToken = parsed.refreshToken || null;

      console.log("[BLAZE] Loaded tokens from disk");
      return;
    }
  } catch (err) {
    console.error("[BLAZE] Failed to load tokens from disk:", err.message);
  }

  // Fallback: env only (first run after OAuth)
  accessToken = process.env.BLAZE_ACCESS_TOKEN || null;
  refreshToken = process.env.BLAZE_REFRESH_TOKEN || null;

  if (accessToken || refreshToken) {
    console.log("[BLAZE] Loaded tokens from env (initial run)");
  }
}

// Persist tokens to disk after a successful refresh
function saveTokensToDisk() {
  try {
    const payload = {
      accessToken,
      refreshToken
    };

    fs.writeFileSync(TOKENS_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log("[BLAZE] Saved tokens to disk");
  } catch (err) {
    console.error("[BLAZE] Failed to save tokens to disk:", err.message);
  }
}

// Call this once at backend startup
export function initBlazeTokens() {
  loadTokensFromDisk();
}

export function getBlazeAccessToken() {
  return accessToken;
}

export function getBlazeRefreshToken() {
  return refreshToken;
}

// Non‑throwing refresh: returns new access token or null
export async function refreshBlazeToken() {
  const clientId = process.env.BLAZE_CLIENT_ID;
  const clientSecret = process.env.BLAZE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[BLAZE] Missing client credentials for refresh");
    return null;
  }

  if (!refreshToken) {
    console.warn("[BLAZE] No refresh token available; cannot refresh");
    return null;
  }

  console.log("[BLAZE] Refreshing Blaze token...");

  try {
    const res = await axios.post("https://blaze.stream/bapi/oauth2/refresh", {
      clientId,
      clientSecret,
      refreshToken
    }, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    });

    const data = res.data;

    accessToken = data.accessToken;
    refreshToken = data.refreshToken;

    saveTokensToDisk();

    console.log("[BLAZE] Token refresh successful");
    return accessToken;
  } catch (err) {
    const status = err?.response?.status;
    const body = err?.response?.data;

    console.error("[BLAZE] Failed to refresh Blaze token:", status, body || err.message);

    // Do NOT throw — just return null so callers can handle gracefully
    return null;
  }
}
