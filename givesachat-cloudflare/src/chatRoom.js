// givesachat-cloudflare/src/chatRoom.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   ChatRoom

   Uses the WebSocket Hibernation API: state.acceptWebSocket()
   plus webSocketMessage/Close/Error handlers, rather than
   server.accept() with event listeners.

   The difference is billing. A durable object holding a
   WebSocket the old way stays resident and bills wall-clock
   duration for as long as the socket is open — an entire
   stream, times every OBS source and device connected. With
   hibernation the object is evicted from memory while the
   sockets stay open, and is only revived when a message
   actually arrives.

   Behaviour is unchanged: same broadcast, same relay rules.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   What a connected client is allowed to relay.

   The popups overlay legitimately pushes reward cards and
   stream alerts into chat via sendToChatOverlay(). Nothing
   else should ever originate from a browser — in particular
   "chat", which would let a connected client fabricate chat
   messages on the live overlay.
--------------------------------------------------------- */
const RELAYABLE_TYPES = ["reward", "velora_system"];

// String fields that end up rendered as HTML downstream.
const TEXT_FIELDS = [
  "html", "message", "username", "displayName", "alertType"
];

function scrub(value, depth = 0) {
  if (depth > 6) return null;

  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));

  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        typeof v === "string" && TEXT_FIELDS.includes(k)
          ? sanitizeHtml(v)
          : scrub(v, depth + 1);
    }
    return out;
  }

  return value;
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    /* ---------------------------------------------------------
       ⭐ WebSocket upgrade → attach overlay client
    --------------------------------------------------------- */
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();

      // Hibernatable: the runtime holds the socket, not us.
      this.state.acceptWebSocket(pair[1]);

      return new Response(null, {
        status: 101,
        webSocket: pair[0]
      });
    }

    /* ---------------------------------------------------------
       ⭐ HTTP broadcast → Velora / Beam → DO → overlay
    --------------------------------------------------------- */
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event, null);   // sender=null → broadcast to all
      return new Response("OK");
    }

    /* ---------------------------------------------------------
       ⭐ How many overlays are connected?

       BeamRoom polls this to decide whether its SSE connection
       is worth holding open — see IDLE_SHUTDOWN_MS there.
    --------------------------------------------------------- */
    if (url.pathname === "/clients") {
      return new Response(
        JSON.stringify({ count: this.state.getWebSockets().length }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }

  /* ---------------------------------------------------------
     ⭐ Incoming message from an overlay.

     Hibernation delivers these here instead of to an event
     listener. DO NOT echo back to the sender.
  --------------------------------------------------------- */
  async webSocketMessage(ws, message) {
    let parsed;

    try {
      parsed = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message)
      );
    } catch {
      // Non-JSON from a client is never meaningful — drop it.
      return;
    }

    // Heartbeats stay between the client and this object.
    if (parsed?.type === "ping") return;

    if (!RELAYABLE_TYPES.includes(parsed?.type)) {
      console.warn("Dropped non-relayable client message:", parsed?.type);
      return;
    }

    this.broadcast(scrub(parsed), ws);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch {}
  }

  async webSocketError(ws, error) {
    console.warn("[ChatRoom] socket error:", error?.message || error);
  }

  /* ---------------------------------------------------------
     ⭐ Broadcast to all connected overlay clients
     (except sender)
  --------------------------------------------------------- */
  broadcast(event, sender) {
    const sockets = this.state.getWebSockets();
    if (!sockets.length) return;

    const payload = JSON.stringify(event);

    for (const ws of sockets) {
      if (ws === sender) continue;   // ⭐ Never echo back to sender

      try {
        ws.send(payload);
      } catch {
        // Dead socket — the runtime will clean it up.
      }
    }
  }
}
