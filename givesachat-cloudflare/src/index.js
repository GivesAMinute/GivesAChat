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
       1. Normalize overlay route
    --------------------------------------------------------- */
    if (request.method === "GET" && url.pathname === "/overlay/chat") {
      url.pathname = "/overlay/chat/";
      return Response.redirect(url.toString(), 301);
    }

    /* ---------------------------------------------------------
       2. Static assets (JS MIME FIX INCLUDED)
    --------------------------------------------------------- */
    if (request.method === "GET" && request.headers.get("Upgrade") !== "websocket") {
      let path = url.pathname;

      if (path.endsWith("/")) {
        path += "index.html";
      }

      const assetUrl = new URL(path, request.url);
      let assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));

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
       3. WebSocket: Chat Overlay
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/ws/chat")) {
      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       4. WebSocket: Popup Overlay
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/ws/popups")) {
      const id = env.PopupRoom.idFromName("givesachat-popups-v3");
      const room = env.PopupRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       5. Velora OAuth Login
    --------------------------------------------------------- */
    if (url.pathname === "/velora/login" && request.method === "GET") {
      const authUrl = generateAuthorizationUrl(env);
      return Response.redirect(authUrl, 302);
    }

    /* ---------------------------------------------------------
       6. Velora OAuth Callback
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
       7. Velora Access Token
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
       8. Velora TokenStore DO Routing
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
       9. Velora → ChatRoom Broadcast
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

      if (!mapped) {
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
       Default fallback
    --------------------------------------------------------- */
    return new Response("Not found", { status: 404 });
  }
};
