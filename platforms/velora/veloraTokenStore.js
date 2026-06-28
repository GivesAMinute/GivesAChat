// platforms/velora/veloraTokenStore.js

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
  // Do NOT write to disk — Railway does not persist files.
}
