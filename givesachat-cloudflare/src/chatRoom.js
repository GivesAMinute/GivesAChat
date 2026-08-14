// givesachat-cloudflare/src/chatRoom.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

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

    // ⭐ Always track active WebSocket clients
    this.clients = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    /* ---------------------------------------------------------
       ⭐ WebSocket upgrade → attach overlay client
    --------------------------------------------------------- */
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    /* ---------------------------------------------------------
       ⭐ HTTP broadcast → Velora → DO → overlay
       (Beam removed permanently)
    --------------------------------------------------------- */
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event, null);   // sender=null → broadcast to all
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    // No scheduled tasks
    return;
  }

  /* ---------------------------------------------------------
     ⭐ WebSocket connection handler
  --------------------------------------------------------- */
  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    // ⭐ Add new client
    this.clients.push(server);

    /* ---------------------------------------------------------
       ⭐ Incoming message from overlay
       DO NOT echo back to sender
    --------------------------------------------------------- */
    server.addEventListener("message", (msg) => {
      let parsed;

      try {
        parsed = JSON.parse(msg.data);
      } catch {
        // Non-JSON from a client is never meaningful — drop it.
        // (Previously this was rebroadcast verbatim.)
        return;
      }

      // Heartbeats stay between the client and this object.
      if (parsed?.type === "ping") return;

      if (!RELAYABLE_TYPES.includes(parsed?.type)) {
        console.warn("Dropped non-relayable client message:", parsed?.type);
        return;
      }

      this.broadcast(scrub(parsed), server);
    });

    /* ---------------------------------------------------------
       ⭐ Cleanup on disconnect
    --------------------------------------------------------- */
    const cleanup = () => {
      this.clients = this.clients.filter((ws) => ws !== server);
    };

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  /* ---------------------------------------------------------
     ⭐ Broadcast to all connected overlay clients
     (except sender)
  --------------------------------------------------------- */
  broadcast(event, sender) {
    if (!this.clients.length) return;

    const payload = JSON.stringify(event);
    const alive = [];

    for (const ws of this.clients) {
      if (ws === sender) continue;   // ⭐ Never echo back to sender

      try {
        ws.send(payload);
        alive.push(ws);
      } catch {
        // Dead socket → drop it
      }
    }

    // ⭐ Keep only alive sockets
    this.clients = alive;
  }
}
