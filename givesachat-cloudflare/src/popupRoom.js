// givesachat-cloudflare/src/popupRoom.js

/* ---------------------------------------------------------
   PopupRoom

   Same hibernation treatment as ChatRoom — see the note there
   for why. This object previously stayed resident for the life
   of every open popups overlay, billing duration the whole
   time for a socket that is idle most of the stream.
--------------------------------------------------------- */

export class PopupRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();

      this.state.acceptWebSocket(pair[1]);

      return new Response(null, {
        status: 101,
        webSocket: pair[0]
      });
    }

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event);
      return new Response("OK");
    }

    if (url.pathname === "/clients") {
      return new Response(
        JSON.stringify({ count: this.state.getWebSockets().length }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }

  /* ---------------------------------------------------------
     The popups overlay sends a {type:"ping"} heartbeat every
     25s. It only needs to keep the socket alive — there is
     nothing to rebroadcast.
  --------------------------------------------------------- */
  async webSocketMessage(ws, message) {
    // Intentionally inert.
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch {}
  }

  async webSocketError(ws, error) {
    console.warn("[PopupRoom] socket error:", error?.message || error);
  }

  broadcast(event) {
    const sockets = this.state.getWebSockets();
    if (!sockets.length) return;

    const payload = JSON.stringify(event);

    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // Dead socket — the runtime will clean it up.
      }
    }
  }
}
