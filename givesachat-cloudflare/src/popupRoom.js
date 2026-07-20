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

  touch() {
    this.lastActivity = Date.now();
    // 120s idle timeout
    this.storage.setAlarm(this.lastActivity + 120 * 1000);
  }

  async alarm() {
    const now = Date.now();
    if (now - this.lastActivity >= 120 * 1000) {
      for (const ws of this.clients) {
        try { ws.close(1000, "Idle timeout"); } catch {}
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

    let idleTimer = setTimeout(() => {
      try { server.close(1000, "Idle timeout"); } catch {}
    }, 120000);

    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try { server.close(1000, "Idle timeout"); } catch {}
      }, 120000);
    };

    server.addEventListener("message", () => {
      this.touch();
      resetIdle();
    });

    const cleanup = () => {
      clearTimeout(idleTimer);
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
