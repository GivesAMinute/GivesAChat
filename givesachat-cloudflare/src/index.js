import { ChatRoom } from "./chatRoom.js";
import { PopupRoom } from "./popupRoom.js";
import { VeloraTokenStore } from "./veloraTokenStore.js";

import {
  generateAuthorizationUrl,
  exchangeAuthCode,
  getVeloraAccessToken
} from "./veloraAuth.js";

import { transformVeloraEvent } from "./veloraTransform.js";

/* ---------------------------------------------------------
   ⭐ DURABLE OBJECT EXPORTS (REQUIRED SHAPE)
--------------------------------------------------------- */
export { ChatRoom, VeloraTokenStore, PopupRoom };

/* ---------------------------------------------------------
   ⭐ WORKER EXPORT (FETCH ONLY)
--------------------------------------------------------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    console.log("REQ", {
      path: url.pathname,
      method: request.method,
      upgrade: request.headers.get("Upgrade"),
      cf: request.cf
    });

    /* ---------------------------------------------------------
       0. Redirect root → chat overlay
    --------------------------------------------------------- */
    if (url.pathname === "/") {
      console.log("REDIRECT_ROOT");
      return Response.redirect(url.origin + "/overlay/chat/", 302);
    }

    /* ---------------------------------------------------------
       1. Normalize overlay routes
    --------------------------------------------------------- */
    if (url.pathname === "/overlay/chat") {
      console.log("NORMALIZE_CHAT");
      return Response.redirect(url.origin + "/overlay/chat/", 301);
    }

    if (url.pathname === "/overlay/popups") {
      console.log("NORMALIZE_POPUPS");
      return Response.redirect(url.origin + "/overlay/popups/", 301);
    }

    /* ---------------------------------------------------------
       ⭐ 2. WebSocket: Chat Overlay
       FIXED: forward the original request straight to the DO.
       The DO creates the WebSocketPair itself and returns the
       101 response — the Worker does not touch WebSocketPair.
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/ws/chat")) {
      console.log("WS_CHAT_MATCH", {
        path: url.pathname,
        upgrade: request.headers.get("Upgrade")
      });

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      console.log("WS_CHAT_DO_FETCH");

      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 3. WebSocket: Popup Overlay
       FIXED: same pattern as /ws/chat above.
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/ws/popups")) {
      console.log("WS_POPUPS_MATCH", {
        path: url.pathname,
        upgrade: request.headers.get("Upgrade")
      });

      const id = env.PopupRoom.idFromName("givesachat-popups-v3");
      const room = env.PopupRoom.get(id);

      console.log("WS_POPUPS_DO_FETCH");

      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       ⭐ 4. Static assets
    --------------------------------------------------------- */
    if (request.method === "GET" && !request.headers.get("Upgrade")) {
      console.log("ASSETS_INTERCEPT", {
        path: url.pathname,
        upgrade: request.headers.get("Upgrade")
      });

      let path = url.pathname;

      if (path.endsWith("/")) {
        path += "index.html";
      }

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

        console.log("ASSET_SERVE", { path });
        return assetResponse;
      }
    }

    /* ---------------------------------------------------------
       5. Velora OAuth Login
    --------------------------------------------------------- */
    if (url.pathname === "/velora/login") {
      console.log("VELORA_LOGIN");
      return Response.redirect(generateAuthorizationUrl(env), 302);
    }

    /* ---------------------------------------------------------
       6. Velora OAuth Callback
    --------------------------------------------------------- */
    if (url.pathname === "/velora/callback") {
      console.log("VELORA_CALLBACK");
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      const accessToken = await exchangeAuthCode(code, env);
      if (!accessToken) return new Response("Failed to authorize Velora", { status: 500 });

      return new Response("Velora authorized. You can close this window.");
    }

    /* ---------------------------------------------------------
       7. Velora Access Token
    --------------------------------------------------------- */
    if (url.pathname === "/api/velora/access-token") {
      console.log("VELORA_ACCESS_TOKEN");
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
       8. Velora TokenStore DO Routing
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/velora-token")) {
      console.log("VELORA_TOKENSTORE", { path: url.pathname });

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
       9. Velora → ChatRoom Broadcast
    --------------------------------------------------------- */
    if (url.pathname === "/api/events/velora" && request.method === "POST") {
      console.log("VELORA_EVENT");

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

      if (!mapped) {
        console.log("VELORA_EVENT_IGNORED");
        return new Response("Ignored", { status: 200 });
      }

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      console.log("VELORA_EVENT_BROADCAST");
      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mapped)
        })
      );
    }

    /* ---------------------------------------------------------
       10. Default fallback
    --------------------------------------------------------- */
    console.log("NOT_FOUND", { path: url.pathname });
    return new Response("Not found", { status: 404 });
  }
};