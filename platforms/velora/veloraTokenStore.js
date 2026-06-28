// platforms/velora/veloraTokenStore.js

/* ---------------------------------------------------------
   ⭐ REFRESH TOKEN (ENV ONLY)
--------------------------------------------------------- */
export function loadRefreshToken() {
  const token = process.env.VELORA_REFRESH_TOKEN;
  if (token) {
    console.log("[VELORA] Loaded refresh token from ENV");
    return token;
  }

  console.log("[VELORA] No refresh token in ENV");
  return null;
}

export function saveRefreshToken(token) {
  console.log("[VELORA] New refresh token received (ENV must be updated manually)");
  // Railway cannot persist files, so user must update ENV manually.
}

/* ---------------------------------------------------------
   ⭐ ACCESS TOKEN (IN-MEMORY ONLY)
   Prevents refresh-on-startup from burning tokens.
--------------------------------------------------------- */

// In-memory access token (survives runtime, not restarts)
let accessTokenMemory = null;

export function loadAccessToken() {
  if (accessTokenMemory) {
    console.log("[VELORA] Loaded access token from memory");
    return accessTokenMemory;
  }

  console.log("[VELORA] No access token in memory");
  return null;
}

export function saveAccessToken(token) {
  accessTokenMemory = token;
  console.log("[VELORA] Saved access token to memory");
}
