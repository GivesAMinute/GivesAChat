// givesachat-cloudflare/src/popupRoom.js

export class PopupRoom {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
    this.clients = [];
    this.lastActivity = Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);

    this.touch();

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

  touch() {
    this.lastActivity = Date.now();
    this.storage.setAlarm(this.lastActivity + 5 * 60 * 1000);
  }

  async alarm() {
    const now = Date.now();
    if (now - this.lastActivity >= 5 * 60 * 1000) {
      for (const ws of this.clients) {
        try {
          ws.close(1000, "Idle timeout");
        } catch {
          // ignore
        }
      }
      this.clients = [];
    }
  }

  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.clients.push(server);
    this.touch();

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
        // drop dead socket
      }
    }

    this.clients = alive;
  }
}
