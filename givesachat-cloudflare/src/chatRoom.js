// givesachat-cloudflare/src/chatRoom.js

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
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
    this.state.storage.setAlarm(this.lastActivity + 30 * 1000); // 30s idle timeout
  }

  async alarm() {
    const now = Date.now();
    if (now - this.lastActivity >= 30 * 1000) {
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
    }, 30000);

    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try { server.close(1000, "Idle timeout"); } catch {}
      }, 30000);
    };

    server.addEventListener("message", (msg) => {
      this.touch();
      resetIdle();

      try {
        const parsed = JSON.parse(msg.data);
        this.broadcast(parsed);
      } catch {
        this.broadcast({ type: "client", data: msg.data });
      }
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
