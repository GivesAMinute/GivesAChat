// givesachat-cloudflare/src/chatRoom.js

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
      try {
        const parsed = JSON.parse(msg.data);
        this.broadcast(parsed, server);
      } catch {
        this.broadcast({ type: "client", data: msg.data }, server);
      }
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
