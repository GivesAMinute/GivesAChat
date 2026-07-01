// platforms/velora/veloraAuth.js
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  loadRefreshToken,
  saveRefreshToken,
  saveAccessToken,
  loadAccessToken
} from "./veloraTokenStore.js";

const DATA_DIR = "/data";
const PKCE_FILE = path.join(DATA_DIR, "velora_pkce.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/* ---------------------------------------------------------
   ⭐ PKCE STORAGE
--------------------------------------------------------- */
function savePkceVerifier(verifier) {
  ensureDir();
  fs.writeFileSync(PKCE_FILE, JSON.stringify({ verifier }, null, 2), "utf8");
}

function loadPkceVerifier() {
  ensureDir();
  if (!fs.existsSync(PKCE_FILE)) return null;

  try {
    const json = JSON.parse(fs.readFileSync(PKCE_FILE, "utf8"));
    return json.verifier || null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------
   ⭐ PKCE GENERATION
--------------------------------------------------------- */
function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest()
  );

  savePkceVerifier(verifier);

  return { verifier, challenge };
}

/* ---------------------------------------------------------
   ⭐ AUTHORIZATION URL (Broadcaster OAuth)
--------------------------------------------------------- */
export function generateAuthorizationUrl() {
  const { challenge } = generatePkce();

  const params = new URLSearchParams({
    client_id: process.env.VELORA_CLIENT_ID,
    redirect_uri: process.env.VELORA_REDIRECT_URI,
    response_type: "code",
    scope: "user:read user:write stream:read stream:write stream:key chat:read chat:write chat:moderate bot:connect bot:write bot:commands channel:read channel:points:read channel:points:redeem emotes:read followers:read subscriptions:read webhooks:manage bot:manage",
    state: crypto.randomBytes(16).toString("hex"),
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  // ⭐ Correct broadcaster authorize URL
  return `https://velora.tv/oauth/authorize?${params.toString()}`;
}

/* ---------------------------------------------------------
   ⭐ EXCHANGE AUTH CODE → BROADCASTER TOKENS
--------------------------------------------------------- */
export async function exchangeAuthCode(code) {
  const verifier = loadPkceVerifier();
  if (!verifier) {
    console.error("[VELORA] No PKCE verifier found");
    return null;
  }

  try {
    const res = await axios.post(
      "https://api.velora.tv/api/oauth/token",   // ⭐ Correct token endpoint
      {
        grant_type: "authorization_code",
        client_id: process.env.VELORA_CLIENT_ID,
        client_secret: process.env.VELORA_CLIENT_SECRET,
        code,
        redirect_uri: process.env.VELORA_REDIRECT_URI,
        code_verifier: verifier
      }
    );

    const { access_token, refresh_token, expires_in } = res.data;

    if (refresh_token) saveRefreshToken(refresh_token);
    if (access_token) saveAccessToken(access_token, expires_in);

    return access_token;
  } catch (err) {
    console.error("[VELORA] Failed to exchange auth code:", err.response?.data || err);
    return null;
  }
}

/* ---------------------------------------------------------
   ⭐ REFRESH TOKEN → BROADCASTER ACCESS TOKEN
--------------------------------------------------------- */
export async function refreshVeloraToken() {
  const refreshToken = loadRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await axios.post(
      "https://api.velora.tv/api/oauth/token",   // ⭐ Correct token endpoint
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.VELORA_CLIENT_ID,
        client_secret: process.env.VELORA_CLIENT_SECRET
      }
    );

    const { access_token, refresh_token, expires_in } = res.data;

    if (refresh_token) saveRefreshToken(refresh_token);
    if (access_token) saveAccessToken(access_token, expires_in);

    return access_token;
  } catch (err) {
    console.error("[VELORA] Failed to refresh token:", err.response?.data || err);
    return null;
  }
}

/* ---------------------------------------------------------
   ⭐ MAIN ACCESS TOKEN ENTRYPOINT
--------------------------------------------------------- */
export async function getVeloraAccessToken() {
  const existing = loadAccessToken();
  if (existing) return existing;

  const refreshed = await refreshVeloraToken();
  if (refreshed) return refreshed;

  console.log("[VELORA] No refresh token — user must authorize Velora");
  console.log("[VELORA] Visit this URL to authorize:");
  console.log(generateAuthorizationUrl());

  return null;
}
