// givesachat-cloudflare/src/veloraAuth.js

import { getVeloraTokens, saveVeloraTokens } from "./veloraTokenStore.js";

/**
 * Generate Velora OAuth authorization URL (Broadcaster OAuth)
 */
export function generateAuthorizationUrl(env) {
  const params = new URLSearchParams({
    client_id: env.VELORA_CLIENT_ID,
    redirect_uri: env.VELORA_REDIRECT_URI,
    response_type: "code",
    scope:
      "user:read user:write " +
      "stream:read stream:write stream:key " +
      "chat:read chat:write chat:moderate " +
      "bot:connect bot:write bot:commands bot:manage " +
      "channel:read channel:points:read channel:points:redeem " +
      "emotes:read followers:read subscriptions:read " +
      "webhooks:manage",
    state: crypto.randomUUID()
  });

  return `https://velora.tv/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange OAuth code → Velora tokens
 */
export async function exchangeAuthCode(code, env) {
  const url = "https://api.velora.tv/api/developer/oauth/token";

  const body = {
    grant_type: "authorization_code",
    code,
    client_id: env.VELORA_CLIENT_ID,
    client_secret: env.VELORA_CLIENT_SECRET,
    redirect_uri: env.VELORA_REDIRECT_URI
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[VELORA] OAuth exchange failed:", res.status, text);
    throw new Error("Velora OAuth failed");
  }

  const json = await res.json();

  await saveVeloraTokens(env, json);

  return json.access_token;
}

/**
 * Refresh Velora access token
 */
export async function refreshVeloraToken(env) {
  const tokens = await getVeloraTokens(env);

  if (!tokens?.refresh_token) {
    console.warn("[VELORA] No refresh token available");
    return null;
  }

  const url = "https://api.velora.tv/api/developer/oauth/token";

  const body = {
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: env.VELORA_CLIENT_ID,
    client_secret: env.VELORA_CLIENT_SECRET
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[VELORA] Token refresh failed:", res.status, text);
    return null;
  }

  const json = await res.json();

  await saveVeloraTokens(env, json);

  return json.access_token;
}

/**
 * Legacy compatibility for emotes + chat socket
 * Cloudflare version returns the SAME token Railway used:
 * - access_token from VeloraTokenStore
 * - auto-refresh if expired
 */
export async function getVeloraAccessToken(env) {
  const tokens = await getVeloraTokens(env);

  if (!tokens?.access_token) {
    console.warn("[VELORA] No access token stored");
    return null;
  }

  const now = Date.now();
  if (tokens.expires_at && now >= tokens.expires_at) {
    console.log("[VELORA] Access token expired — refreshing...");
    const refreshed = await refreshVeloraToken(env);
    return refreshed;
  }

  return tokens.access_token;
}
