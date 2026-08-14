import { VERSION } from "./version.js";

import { ChatRoom } from "./chatRoom.js";
import { PopupRoom } from "./popupRoom.js";
import {
  generateAuthorizationUrl,
  exchangeAuthCode,
  getVeloraAccessToken
} from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";
import { VeloraTokenStore } from "./veloraTokenStore.js";

export { ChatRoom, VeloraTokenStore, PopupRoom };

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
      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 2. WebSocket for popup overlay (MUST STAY ABOVE ASSETS)
    --------------------------------------------------------- */
    if (url.pathname === "/ws/popups") {
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
      const authUrl = generateAuthorizationUrl(env);
      return Response.redirect(authUrl, 302);
    }

    /* ---------------------------------------------------------
       6. Velora OAuth callback
    --------------------------------------------------------- */
    if (url.pathname === "/velora/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

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
       8. DO routing block
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/velora-token")) {
      const id = env.VeloraTokenStore.idFromName("velora-tokens");
      const stub = env.VeloraTokenStore.get(id);

      const body =
        request.method !== "GET" && request.method !== "HEAD"
          ? await request.text()
          : null;

      const headers = new Headers(request.headers);

      return stub.fetch("https://do" + url.pathname, {
        method: request.method,
        headers,
        body
      });
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
        html: beamEvent.html || beamEvent.message || "",
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
        html: externalEvent.html || externalEvent.message || "",
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
          html: scaleBlazeEmotes(blazeEvent.message || ""),
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
