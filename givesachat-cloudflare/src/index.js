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

export { ChatRoom, VeloraTokenStore, PopupRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* ---------------------------------------------------------
       ⭐ 0. Redirect root → chat overlay (absolute URL)
    --------------------------------------------------------- */
    if (url.pathname === "/") {
      return Response.redirect(url.origin + "/overlay/chat/", 302);
    }

    /* ---------------------------------------------------------
       ⭐ 1. Normalize overlay routes (absolute URLs)
    --------------------------------------------------------- */
    if (url.pathname === "/overlay/chat") {
      return Response.redirect(url.origin + "/overlay/chat/", 301);
    }

    if (url.pathname === "/overlay/popups") {
      return Response.redirect(url.origin + "/overlay/popups/", 301);
    }

    /* ---------------------------------------------------------
       ⭐ 2. WebSocket: Chat Overlay
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/ws/chat")) {
      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      return env.ChatRoom.get(id).fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 3. WebSocket: Popup Overlay
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/ws/popups")) {
      const id = env.PopupRoom.idFromName("givesachat-popups-v3");
      return env.PopupRoom.get(id).fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 4. Static assets (FIXED URL PARSING)
    --------------------------------------------------------- */
    if (request.method === "GET" && request.headers.get("Upgrade") !== "websocket") {
      let path = url.pathname;

      if (path.endsWith("/")) {
        path += "index.html";
      }

      // ⭐ FIX: Always use url.origin, never request.url
      const assetUrl = new URL(path, url.origin);

      let assetResponse = await env.ASSETS.fetch(
        new Request(assetUrl, request)
      );

      if (assetResponse.status !== 404) {
        const ext = path.split(".").pop();
        if (ext === "js") {
          assetResponse = new Response(assetResponse.body, {
            headers: { "Content-Type": "application/javascript" }
          });
        }
        return assetResponse;
      }
    }

    /* ---------------------------------------------------------
       ⭐ 5. Velora OAuth Login
    --------------------------------------------------------- */
    if (url.pathname === "/velora/login") {
      return Response.redirect(generateAuthorizationUrl(env), 302);
    }

    /* ---------------------------------------------------------
       ⭐ 6. Velora OAuth Callback
    --------------------------------------------------------- */
    if (url.pathname === "/velora/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      const accessToken = await exchangeAuthCode(code, env);
      if (!accessToken) return new Response("Failed to authorize Velora", { status: 500 });

      return new Response("Velora authorized. You can close this window.");
    }

    /* ---------------------------------------------------------
       ⭐ 7. Velora Access Token
    --------------------------------------------------------- */
    if (url.pathname === "/api/velora/access-token") {
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
       ⭐ 8. Velora TokenStore DO Routing
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/velora-token")) {
      const id = env.VeloraTokenStore.idFromName("velora-tokens");
      const stub = env.VeloraTokenStore.get(id);

      const body =
        request.method !== "GET" && request.method !== "HEAD"
          ? await request.text()
          : null;

      return stub.fetch("https://do" + url.pathname, {
        method: request.method,
        headers: request.headers,
        body
      });
    }

    /* ---------------------------------------------------------
       ⭐ 9. Velora → ChatRoom Broadcast
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
       ⭐ 10. Default fallback
    --------------------------------------------------------- */
    return new Response("Not found", { status: 404 });
  }
};
