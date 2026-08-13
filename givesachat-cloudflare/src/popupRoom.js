export class PopupRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ws = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade");

    console.log("DO_POPUP_FETCH", {
      path: url.pathname,
      upgrade
    });

    /* ---------------------------------------------------------
       ⭐ WebSocket Upgrade
       FIXED: the DO now creates the WebSocketPair itself,
       instead of expecting request.webSocket to already be
       populated by the Worker (it never was — that's why
       DO_POPUP_WS_NO_SERVER was firing every time).
    --------------------------------------------------------- */
    if (upgrade === "websocket") {
      console.log("DO_POPUP_WS_UPGRADE");

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      try {
        server.accept();
        console.log("DO_POPUP_WS_ACCEPTED");
      } catch (err) {
        console.log("DO_POPUP_WS_ACCEPT_ERROR", err);
        return new Response("WS accept failed", { status: 500 });
      }

      this.ws = server;

      server.addEventListener("message", evt => {
        console.log("DO_POPUP_WS_MESSAGE", evt.data);
      });

      server.addEventListener("close", evt => {
        console.log("DO_POPUP_WS_CLOSED", evt.code, evt.reason);
        if (this.ws === server) this.ws = null;
      });

      server.addEventListener("error", err => {
        console.log("DO_POPUP_WS_ERROR", err);
        if (this.ws === server) this.ws = null;
      });

      // ⭐ The DO returns the 101 response with the client socket.
      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    /* ---------------------------------------------------------
       ⭐ Non-WS Broadcast
    --------------------------------------------------------- */
    console.log("DO_POPUP_NON_WS");
    const body = await request.text();

    if (this.ws) {
      try {
        this.ws.send(body);
        console.log("DO_POPUP_SENT", body);
      } catch (err) {
        console.log("DO_POPUP_SEND_ERROR", err);
      }
    } else {
      console.log("DO_POPUP_NO_WS_CONNECTED");
    }

    return new Response("OK");
  }
}