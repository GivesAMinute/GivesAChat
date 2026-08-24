// givesachat-cloudflare/src/veloraAuth.js

import { getVeloraTokens, saveVeloraTokens } from "./veloraTokenStore.js";

/**
 * Generate Velora OAuth authorization URL (Broadcaster OAuth)
 */
export function generateAuthorizationUrl(env, state = crypto.randomUUID()) {
  const params = new URLSearchParams({
    client_id: env.VELORA_CLIENT_ID,
    redirect_uri: env.VELORA_REDIRECT_URI,
    response_type: "code",
    /* ---------------------------------------------------------
       Checked against GET /api/developer/oauth/scopes. Every name
       here is in the live registry.

       FETCH THAT ENDPOINT WITH A CACHE BUSTER IF YOU EVER CHECK
       IT AGAIN. The plain URL is served from a CDN cache that was
       months stale, and it listed a completely different set —
       points:read / points:write instead of the channel:points:*
       family. Reading it produced the confident and entirely
       wrong conclusion that nine of these scopes did not exist.
       ?cb=anything returned the real registry.

       channel:points:write added for the reward renaming: the ^
       trigger IS the reward name with spaces stripped, so short
       names are the only way to get a short command, and PATCH
       /channel-points/rewards/:rewardId is what sets them.

       Scopes are stamped into a token when it is issued, so
       adding one here does nothing until /velora/login is run
       again. An existing token keeps the grants it was born with.
    --------------------------------------------------------- */
    scope:
      "user:read user:write " +
      "stream:read stream:write stream:key " +
      "chat:read chat:write chat:moderate " +
      "bot:connect bot:write bot:commands bot:manage " +
      "channel:read channel:points:read channel:points:redeem " +
      "channel:points:write " +
      "emotes:read followers:read subscriptions:read " +
      "webhooks:manage",
    state
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

  /* ---------------------------------------------------------
     ⭐ VERIFY WHO JUST AUTHORISED, BEFORE STORING ANYTHING.

     /velora/login is deliberately unauthenticated — it has to be
     reachable from a browser to start the flow. The state check
     stops a request being forged on someone else's behalf, but it
     does NOT stop a stranger walking the flow themselves: hit
     /velora/login, get issued a state, approve with their own
     Velora account, and land back here with a valid code.

     The token saved would then be theirs. The store holds one
     set, so ours would be gone and every Velora feature in the
     overlay would go quiet with nothing obviously broken.

     The Facebook flow already guards this with FACEBOOK_OWNER_ID.
     This one had nothing.

     Checked BEFORE saveVeloraTokens, so a wrong account cannot
     overwrite a working token even briefly.
  --------------------------------------------------------- */
  const expected = String(env.VELORA_CHANNEL || "").toLowerCase();

  if (expected) {
    let who = null;

    try {
      const meRes = await fetch("https://api.velora.tv/api/users/me", {
        headers: {
          Authorization: `Bearer ${json.access_token}`,
          Accept: "application/json"
        }
      });

      if (meRes.ok) {
        const me = await meRes.json();
        who = me?.username || me?.user?.username || null;
      } else {
        console.error("[VELORA] /users/me returned", meRes.status);
      }
    } catch (err) {
      console.error("[VELORA] owner check failed:", err?.message || err);
    }

    /* An unreadable identity is a refusal, not a pass. Failing
       open would defeat the entire check. */
    if (!who || who.toLowerCase() !== expected) {
      console.warn(
        `[VELORA] refusing token for "${who || "unknown"}" — expected "${expected}"`
      );
      const err = new Error("Not the channel owner");
      err.notOwner = true;
      throw err;
    }
  } else {
    console.warn("[VELORA] VELORA_CHANNEL unset — owner check skipped");
  }

  await saveVeloraTokens(env, json);

  /* Granted scopes come back on the token response. Returned so
     the callback can display them — a scope silently dropped is
     otherwise only discovered later, as a 403 from whichever call
     needed it. */
  return {
    accessToken: json.access_token,
    scope: json.scope || ""
  };
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
