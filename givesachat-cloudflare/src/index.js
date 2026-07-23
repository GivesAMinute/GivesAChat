// givesachat-cloudflare/src/index.js

import { ChatRoom } from "./chatRoom.js";
import { PopupRoom } from "./popupRoom.js";
import {
  generateAuthorizationUrl,
  exchangeAuthCode,
  getVeloraAccessToken
} from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";
import { VeloraTokenStore } from "./veloraTokenStore.js";
import { fetchYouTubeLiveChat } from "./youtubeLiveChat.js";

export { ChatRoom, VeloraTokenStore, PopupRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* ---------------------------------------------------------
       ⭐ 0. Forced Overlay Route Normalization
       Prevent browsers from loading JS files as HTML documents.
       Guarantees /overlay/chat/ always serves index.html.
    --------------------------------------------------------- */
    if (request.method === "GET") {
      // Normalize /overlay/chat → /overlay/chat/
      if (url.pathname === "/overlay/chat") {
        url.pathname = "/overlay/chat/";
        return Response.redirect(url.toString(), 301);
      }

      // Prevent /overlay/chat/main.js from being treated as HTML
      if (url.pathname === "/overlay/chat/main.js") {
        url.pathname = "/overlay/chat/";
        return Response.redirect(url.toString(), 301);
      }
    }

    /* ---------------------------------------------------------
       ⭐ 1. Beamstream viewer proxy (before DO logic)
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
       ⭐ 2. Static assets — serve index.html for directory paths
    --------------------------------------------------------- */
    if (request.method === "GET") {
      let path = url.pathname;

      // If requesting a directory, serve index.html
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
       ⭐ 3. WebSocket for chat overlay
    --------------------------------------------------------- */
    if (url.pathname === "/ws/chat") {
      const id = env.ChatRoom.idFromName("givesachat-main-v2");
      const room = env.ChatRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 4. WebSocket for popup overlay
    --------------------------------------------------------- */
    if (url.pathname === "/ws/popups") {
      const id = env.PopupRoom.idFromName("givesachat-popups-v2");
      const room = env.PopupRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 5. Velora OAuth login
    --------------------------------------------------------- */
    if (url.pathname === "/velora/login" && request.method === "GET") {
      const authUrl = generateAuthorizationUrl(env);
      return Response.redirect(authUrl, 302);
    }

    /* ---------------------------------------------------------
       ⭐ 6. Velora OAuth callback
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
       ⭐ 7. Velora access token endpoint
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
       ⭐ 8. DO routing block
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
       ⭐ 9. Velora → Worker → DO broadcast
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

      if (!mapped) return new Response("Ignored", { status: 200 });

      const id = env.ChatRoom.idFromName("givesachat-main-v2");
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
       ⭐ 10. YouTube live chat endpoint (rate-limited)
    --------------------------------------------------------- */
    if (url.pathname === "/api/youtube/livechat" && request.method === "GET") {
      const result = await fetchYouTubeLiveChat(env);

      if (result.error === "Rate limited") {
        return new Response(
          JSON.stringify(result),
          {
            status: 429,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify(result),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    return new Response("Not found", { status: 404 });
  }
};
