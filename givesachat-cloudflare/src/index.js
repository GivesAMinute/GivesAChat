import { VERSION } from "./version.js";

import { ChatRoom } from "./chatRoom.js";
import { PopupRoom } from "./popupRoom.js";
import {
  generateAuthorizationUrl,
  exchangeAuthCode,
  getVeloraAccessToken
} from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";
import {
  VeloraTokenStore,
  putOAuthState,
  takeOAuthState
} from "./veloraTokenStore.js";
import { sanitizeHtml } from "./sanitizeNodeHTML.js";

export { ChatRoom, VeloraTokenStore, PopupRoom };

/* ---------------------------------------------------------
   Access control

   Two independent keys, both Cloudflare secrets:

     INGEST_KEY   guards POST /api/events/*   (who may put
                  messages ON the overlay)
     OVERLAY_KEY  guards the WebSocket routes (who may read
                  the feed, and who may relay through it)

   They are separate on purpose: OVERLAY_KEY travels in the
   OBS browser-source URL and can leak on camera, so it must
   not also grant write access to your chat.

   If a key is unset the matching check is skipped and a
   warning is logged, so deploying this cannot take the
   overlay off-air mid-stream. Set both to actually be
   protected:

     npx wrangler secret put INGEST_KEY
     npx wrangler secret put OVERLAY_KEY
--------------------------------------------------------- */

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function checkKey(request, url, expected) {
  if (!expected) return { ok: true, unconfigured: true };

  const provided =
    request.headers.get("x-gac-key") ||
    url.searchParams.get("key") ||
    "";

  return { ok: timingSafeEqual(provided, expected), unconfigured: false };
}

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    console.log("DEBUG Incoming path:", url.pathname);

    /* ---------------------------------------------------------
       0. Forced Overlay Route Normalization
    --------------------------------------------------------- */
    if (request.method === "GET") {
      if (url.pathname === "/") {
        return Response.redirect(url.origin + "/overlay/chat/", 302);
      }

      if (url.pathname === "/overlay/chat") {
        url.pathname = "/overlay/chat/";
        return Response.redirect(url.toString(), 301);
      }

      if (url.pathname === "/overlay/popups") {
        url.pathname = "/overlay/popups/";
        return Response.redirect(url.toString(), 301);
      }

      if (url.pathname === "/overlay/chat/main.js") {
        url.pathname = "/overlay/chat/";
        return Response.redirect(url.toString(), 301);
      }
    }

    /* ---------------------------------------------------------
       ⭐ 1. WebSocket for chat overlay (MUST STAY ABOVE ASSETS)
    --------------------------------------------------------- */
    if (url.pathname === "/ws/chat") {
      const auth = checkKey(request, url, env.OVERLAY_KEY);
      if (!auth.ok) return unauthorized();
      if (auth.unconfigured) console.warn("OVERLAY_KEY unset — /ws/chat is open");

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 2. WebSocket for popup overlay (MUST STAY ABOVE ASSETS)
    --------------------------------------------------------- */
    if (url.pathname === "/ws/popups") {
      const auth = checkKey(request, url, env.OVERLAY_KEY);
      if (!auth.ok) return unauthorized();
      if (auth.unconfigured) console.warn("OVERLAY_KEY unset — /ws/popups is open");

      const id = env.PopupRoom.idFromName("givesachat-popups-v3");
      const room = env.PopupRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       3. Beamstream viewer proxy  ("GIVERS Watching Now")
    --------------------------------------------------------- */
    if (url.pathname === "/api/viewers") {
      try {
        const beamUrl =
          "https://beamstream.gg/api/main/api/v1/channel/625942989834817536/viewers";

        const cache = caches.default;
        const cacheKey = new Request(url.toString(), request);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const res = await fetch(beamUrl, {
          method: "GET",
          headers: { "Accept": "application/json" }
        });

        const data = await res.json();

        const response = new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          }
        });

        response.headers.set("Cache-Control", "public, max-age=5");
        await cache.put(cacheKey, response.clone());

        return response;

      } catch (err) {
        return new Response(
          JSON.stringify({
            error: "Beamstream fetch failed",
            details: err.toString()
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }

    /* ---------------------------------------------------------
       ⭐ 4. Static assets (NOW BELOW WS ROUTES)
    --------------------------------------------------------- */
    if (request.method === "GET" && !request.headers.get("Upgrade")) {
      let path = url.pathname;

      if (path.endsWith("/")) {
        path += "index.html";
      }

      const assetUrl = new URL(path, request.url);

      const assetResponse = await env.ASSETS.fetch(
        new Request(assetUrl, request)
      );

      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    /* ---------------------------------------------------------
       5. Velora OAuth login
    --------------------------------------------------------- */
    if (url.pathname === "/velora/login" && request.method === "GET") {
      const state = crypto.randomUUID();
      await putOAuthState(env, state);

      const authUrl = generateAuthorizationUrl(env, state);
      return Response.redirect(authUrl, 302);
    }

    /* ---------------------------------------------------------
       6. Velora OAuth callback
    --------------------------------------------------------- */
    if (url.pathname === "/velora/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      // The state must match the one issued by /velora/login.
      // Without this check anyone could complete the flow with
      // their own Velora account and overwrite the token store.
      const stateOk = await takeOAuthState(env, url.searchParams.get("state"));
      if (!stateOk) {
        return new Response("Invalid or expired OAuth state", { status: 400 });
      }

      const accessToken = await exchangeAuthCode(code, env);
      if (!accessToken) {
        return new Response("Failed to authorize Velora", { status: 500 });
      }

      return new Response("Velora authorized. You can close this window.");
    }

    /* ---------------------------------------------------------
       7. Velora access token endpoint
    --------------------------------------------------------- */
    if (url.pathname === "/api/velora/access-token" && request.method === "GET") {
      const token = await getVeloraAccessToken(env);

      if (!token) {
        return new Response(JSON.stringify({ error: "No token stored" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ access_token: token }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    /* ---------------------------------------------------------
       8. REMOVED: public /velora-token proxy

       This route exposed the stored access_token AND refresh_token
       to anyone on the internet, and /velora-token/set allowed
       overwriting them. Nothing needed it: the worker talks to the
       token store through the env.VeloraTokenStore binding (see
       getVeloraTokens/saveVeloraTokens), and no browser code calls it.
    --------------------------------------------------------- */

    /* ---------------------------------------------------------
       8b. Ingest guard

       Every /api/events/* route below can put content directly
       on the live overlay, so they all sit behind INGEST_KEY.
       Send it as an "x-gac-key" header, or append "?key=..." to
       the URL where a caller cannot set headers (the Velora
       webhook endpoint being the obvious case).
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/api/events/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();
      if (auth.unconfigured) {
        console.warn("INGEST_KEY unset — event endpoints are open to anyone");
      }
    }

    /* ---------------------------------------------------------
       9. Velora → Worker → DO broadcast
    --------------------------------------------------------- */
    if (url.pathname === "/api/events/velora" && request.method === "POST") {
      let veloraEvent;

      try {
        veloraEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const mapped = await transformVeloraEvent(
        veloraEvent.event,
        veloraEvent,
        env
      );

      if (!mapped || mapped.platform === "beam") {
        return new Response("Ignored", { status: 200 });
      }

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mapped)
        })
      );
    }

    /* ---------------------------------------------------------
       10. Beam → Worker → DO broadcast
    --------------------------------------------------------- */
    if (url.pathname === "/api/events/beam" && request.method === "POST") {
      let beamEvent;

      try {
        beamEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      if (beamEvent.platform === "velora") {
        return new Response("Ignored external Velora", { status: 200 });
      }

      const normalized = {
        platform: beamEvent.platform || "beam",
        username: beamEvent.username || "",
        html: sanitizeHtml(beamEvent.html || beamEvent.message || ""),
        avatar: beamEvent.avatar || null,
        badges: beamEvent.badges || [],
        sticker: beamEvent.sticker || null,
        timestamp: beamEvent.timestamp || Date.now()
      };

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalized)
        })
      );
    }

    /* ---------------------------------------------------------
       11. External → Worker → DO broadcast
    --------------------------------------------------------- */
    if (url.pathname === "/api/events/external" && request.method === "POST") {
      let externalEvent;

      try {
        externalEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const normalized = {
        platform: externalEvent.platform || "external",
        username: externalEvent.username || "",
        html: sanitizeHtml(externalEvent.html || externalEvent.message || ""),
        avatar: externalEvent.avatar || null,
        badges: externalEvent.badges || [],
        sticker: externalEvent.sticker || null,
        timestamp: externalEvent.timestamp || Date.now()
      };

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalized)
        })
      );
    }

    /* ---------------------------------------------------------
       12. Blaze → Worker → DO broadcast
    --------------------------------------------------------- */
    function scaleBlazeEmotes(html) {
      return html.replace(
        /([\u{1F300}-\u{1FAFF}])/gu,
        '<span class="blaze-emote">$1</span>'
      );
    }

    if (url.pathname === "/api/events/blaze" && request.method === "POST") {
      let blazeEvent;

      try {
        blazeEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const sender = blazeEvent.sender || {};

      const normalized = {
        type: "chat",
        platform: "blaze",
        data: {
          username: sender.displayName || sender.username || "",
          html: scaleBlazeEmotes(sanitizeHtml(blazeEvent.message || "")),
          avatar: sender.avatarUrl || null,
          badges: sender.roles || [],
          isOwner: sender.isOwner || false,
          sticker: null,
          timestamp: Date.now()
        }
      };

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalized)
        })
      );
    }

    /* ---------------------------------------------------------
       Default fallback
    --------------------------------------------------------- */
    return new Response("Not found", { status: 404 });
  }
};
