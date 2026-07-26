// updated DO logic

// givesachat-cloudflare/src/chatRoom.js

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event, null);   // ⭐ sender = null for HTTP broadcasts
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
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
        this.broadcast(parsed, server);   // ⭐ DO NOT echo back to sender
      } catch {
        this.broadcast({ type: "client", data: msg.data }, server);
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

  broadcast(event, sender) {
    if (!this.clients.length) return;

    const payload = JSON.stringify(event);
    const alive = [];

    for (const ws of this.clients) {
      if (ws === sender) continue;   // ⭐ skip echoing back to sender

      try {
        ws.send(payload);
        alive.push(ws);
      } catch {}
    }

    this.clients = alive;
  }
}
