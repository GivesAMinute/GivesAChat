// givesachat-cloudflare/src/chatRoom.js

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // Broadcast endpoint
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }

  // ---------------------------------------------------------
  // ⭐ IMPORTANT: fully disable alarms
  // Cloudflare may still call alarm() if older deployments
  // previously scheduled alarms. This prevents auto-close.
  // ---------------------------------------------------------
  async alarm() {
    // Do nothing — no idle shutdown, no cleanup
    return;
  }

  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.clients.push(server);

    server.addEventListener("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        this.broadcast(parsed);
      } catch {
        this.broadcast({ type: "client", data: msg.data });
      }
    });

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

  broadcast(event) {
    if (!this.clients.length) return;

    const payload = JSON.stringify(event);
    const alive = [];

    for (const ws of this.clients) {
      try {
        ws.send(payload);
        alive.push(ws);
      } catch {
        // Drop dead socket
      }
    }

    this.clients = alive;
  }
}
