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

    // Any request = activity
    this.touch();

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // POST /broadcast — Velora events or other server-side broadcasts
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }

  touch() {
    this.lastActivity = Date.now();
    // Set an alarm 5 minutes from now; if no activity, we’ll clean up
    this.state.storage.setAlarm(this.lastActivity + 5 * 60 * 1000);
  }

  async alarm() {
    const now = Date.now();
    // If we’ve been idle for >= 5 minutes, close all sockets and let DO sleep
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

    server.addEventListener("message", (msg) => {
      this.touch();
      try {
        const parsed = JSON.parse(msg.data);
        this.broadcast(parsed);
      } catch (err) {
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
        // drop dead socket
      }
    }

    this.clients = alive;
  }
}
