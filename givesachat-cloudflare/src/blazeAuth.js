// givesachat-cloudflare/src/blazeAuth.js

/* ---------------------------------------------------------
   Blaze — App Access Token + event subscriptions

   channel.chat.message accepts an App Access Token, so this
   needs no user OAuth: no consent screen, no redirect URL in
   play, no refresh token. Client credentials only, and tokens
   last 7 days rather than Velora's 1 hour.

   The secret never leaves the worker. The overlay opens the
   Socket.IO connection itself (Socket.IO does not run in
   workerd), reports its sessionId here, and this code does the
   authenticated subscribe on its behalf. The browser therefore
   never sees a token at all — an improvement on the Velora
   pipeline, where the overlay holds one.
--------------------------------------------------------- */

const TOKEN_URL = "https://blaze.stream/bapi/oauth2/token";
const SUBSCRIBE_URL = "https://api.blaze.stream/v1/events/subscriptions";

/* Chat is the only event the overlay needs today. Adding
   follows or raids later is one entry each — the payloads are
   documented at dev.blaze.stream/docs/events/websocket-events. */
export const BLAZE_EVENT_TYPES = ["channel.chat.message"];

/**
 * App Access Token via the client-credentials flow.
 *
 * Not cached: a subscribe only happens when an overlay opens
 * or reconnects, which is rare, and caching would mean storing
 * a credential we can trivially re-mint. Worth revisiting only
 * if reconnect churn ever becomes noticeable.
 */
export async function getBlazeAppToken(env) {
  if (!env.BLAZE_CLIENT_ID || !env.BLAZE_CLIENT_SECRET) {
    throw new Error(
      "BLAZE_CLIENT_ID or BLAZE_CLIENT_SECRET not configured"
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      clientId: env.BLAZE_CLIENT_ID,
      clientSecret: env.BLAZE_CLIENT_SECRET,
      grantType: "client_credentials"
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blaze token request failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();

  if (!json?.accessToken) {
    throw new Error("Blaze token response carried no accessToken");
  }

  return json.accessToken;
}

/**
 * Attach a live Socket.IO session to the channel's chat events.
 *
 * @param {object} env
 * @param {string} sessionId  from the overlay's session_welcome
 * @returns {Promise<object>} per-event result, for diagnostics
 */
export async function subscribeBlazeSession(env, sessionId) {
  const channelId = env.BLAZE_CHANNEL_ID;

  if (!channelId) throw new Error("BLAZE_CHANNEL_ID not configured");
  if (!sessionId) throw new Error("sessionId required");

  const token = await getBlazeAppToken(env);
  const results = {};

  for (const type of BLAZE_EVENT_TYPES) {
    try {
      const res = await fetch(SUBSCRIBE_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "client-id": env.BLAZE_CLIENT_ID,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          type,
          version: "1",
          sessionId,
          condition: { channelId }
        })
      });

      const body = await res.text();

      results[type] = {
        status: res.status,
        ok: res.ok,
        body: body.slice(0, 300)
      };

      if (!res.ok) {
        console.error(`[BLAZE] subscribe ${type} failed ${res.status}: ${body.slice(0, 200)}`);
      } else {
        console.log(`[BLAZE] subscribed ${type} for session ${sessionId}`);
      }
    } catch (err) {
      results[type] = { ok: false, error: String(err?.message || err) };
      console.error(`[BLAZE] subscribe ${type} threw:`, err);
    }
  }

  return results;
}
