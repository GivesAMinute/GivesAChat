// platforms/velora/veloraTokenStore.js
import fs from "fs";
import path from "path";

// IMPORTANT: Railway persistent volume is mounted at /data
const DATA_DIR = "/data";
const REFRESH_FILE = path.join(DATA_DIR, "velora_refresh_token.json");
const ACCESS_FILE = path.join(DATA_DIR, "velora_access_token.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/* ---------------------------------------------------------
   ⭐ REFRESH TOKEN (PERSISTENT)
--------------------------------------------------------- */
export function loadRefreshToken() {
  ensureDir();

  // Load from persistent volume first
  if (fs.existsSync(REFRESH_FILE)) {
    try {
      const json = JSON.parse(fs.readFileSync(REFRESH_FILE, "utf8"));
      if (json.refreshToken) {
        console.log("[VELORA] Loaded refresh token from persistent volume");
        return json.refreshToken;
      }
    } catch (err) {
      console.error("[VELORA] Failed to read refresh token file:", err.message);
    }
  }

  // Fallback: ENV (first-time only)
  const envToken = process.env.VELORA_REFRESH_TOKEN;
  if (envToken) {
    console.log("[VELORA] Loaded refresh token from ENV (initial)");
    return envToken;
  }

  console.log("[VELORA] No refresh token available at startup");
  return null;
}

export function saveRefreshToken(refreshToken) {
  ensureDir();
  try {
    fs.writeFileSync(
      REFRESH_FILE,
      JSON.stringify({ refreshToken }, null, 2),
      "utf8"
    );
    console.log("[VELORA] Saved rotated refresh token to persistent volume");
  } catch (err) {
    console.error("[VELORA] Failed to save refresh token:", err.message);
  }
}

/* ---------------------------------------------------------
   ⭐ ACCESS TOKEN (PERSISTENT)
--------------------------------------------------------- */
export function loadAccessToken() {
  ensureDir();

  if (!fs.existsSync(ACCESS_FILE)) {
    console.log("[VELORA] No access token file found");
    return null;
  }

  try {
    const json = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8"));
    const { accessToken, expiresAt } = json;

    if (!accessToken || !expiresAt) {
      console.log("[VELORA] Access token file missing fields");
      return null;
    }

    if (Date.now() >= expiresAt) {
      console.log("[VELORA] Stored access token expired");
      return null;
    }

    console.log("[VELORA] Loaded access token from persistent volume");
    return accessToken;
  } catch (err) {
    console.error("[VELORA] Failed to read access token file:", err.message);
    return null;
  }
}

export function saveAccessToken(accessToken, expiresInSeconds) {
  ensureDir();

  const expiresAt = Date.now() + expiresInSeconds * 1000;

  try {
    fs.writeFileSync(
      ACCESS_FILE,
      JSON.stringify({ accessToken, expiresAt }, null, 2),
      "utf8"
    );
    console.log("[VELORA] Saved access token to persistent volume");
  } catch (err) {
    console.error("[VELORA] Failed to save access token:", err.message);
  }
}
