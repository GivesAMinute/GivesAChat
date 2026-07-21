// givesachat-cloudflare/src/popupRoom.js

export class PopupRoom {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
    this.clients = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    // No idle shutdown
  }

  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.clients.push(server);

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
      } catch {}
    }

    this.clients = alive;
  }
}
