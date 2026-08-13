// givesachat-cloudflare/src/chatRoom.js

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (request.headers.get("Upgrade") === "websocket") {
        return this.handleWebSocket(request);
      }

      if (request.method === "POST" && url.pathname === "/broadcast") {
        const event = await request.json();
        this.broadcast(event, null);
        return new Response("OK");
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("ChatRoom error: " + err.message, {
        status: 500
      });
    }
  }

  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.clients.push(server);

    const cleanup = () => {
      this.clients = this.clients.filter(ws => ws !== server);
    };

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    server.addEventListener("message", msg => {
      try {
        const parsed = JSON.parse(msg.data);
        this.broadcast(parsed, server);
      } catch {
        this.broadcast({ type: "client", data: msg.data }, server);
      }
    });

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
      if (ws === sender) continue;

      try {
        ws.send(payload);
        alive.push(ws);
      } catch {
        // dead socket
      }
    }

    this.clients = alive;
  }
}
