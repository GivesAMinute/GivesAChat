// givesachat-cloudflare/src/chatRoom.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   ChatRoom

   Uses the WebSocket Hibernation API: state.acceptWebSocket()
   plus webSocketMessage/Close/Error handlers, rather than
   server.accept() with event listeners.

   The difference is billing. A durable object holding a
   WebSocket the old way stays resident and bills wall-clock
   duration for as long as the socket is open — an entire
   stream, times every OBS source and device connected. With
   hibernation the object is evicted from memory while the
   sockets stay open, and is only revived when a message
   actually arrives.

   Behaviour is unchanged: same broadcast, same relay rules.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   What a connected client is allowed to relay.

   The popups overlay legitimately pushes reward cards and
   stream alerts into chat via sendToChatOverlay(). Nothing
   else should ever originate from a browser — in particular
   "chat", which would let a connected client fabricate chat
   messages on the live overlay.
--------------------------------------------------------- */
const RELAYABLE_TYPES = ["reward", "velora_system"];

// String fields that end up rendered as HTML downstream.
const TEXT_FIELDS = [
  "html", "message", "username", "displayName", "alertType"
];

function scrub(value, depth = 0) {
  if (depth > 6) return null;

  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));

  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        typeof v === "string" && TEXT_FIELDS.includes(k)
          ? sanitizeHtml(v)
          : scrub(v, depth + 1);
    }
    return out;
  }

  return value;
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    /* ---------------------------------------------------------
       ⭐ WebSocket upgrade → attach overlay client
    --------------------------------------------------------- */
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();

      // Hibernatable: the runtime holds the socket, not us.
      this.state.acceptWebSocket(pair[1]);

      /* ---------------------------------------------------------
         Read-only sockets (VIEWER_KEY) may receive but never
         relay. The flag is set by the worker, not the client.

         serializeAttachment survives hibernation — a plain
         property on `this` would not, since the object is
         evicted between messages.
      --------------------------------------------------------- */
      const readOnly = request.headers.get("x-gac-readonly") === "1";
      const role = request.headers.get("x-gac-role") === "popups" ? "popups" : "chat";
      pair[1].serializeAttachment({ readOnly, role });

      return new Response(null, {
        status: 101,
        webSocket: pair[0]
      });
    }

    /* ---------------------------------------------------------
       ⭐ HTTP broadcast → Velora / Beam → DO → overlay
    --------------------------------------------------------- */
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.json();
      this.broadcast(event, null);   // sender=null → broadcast to all
      return new Response("OK");
    }

    /* ---------------------------------------------------------
       ⭐ How many overlays are actually WATCHING?

       The platform rooms use this to decide whether their
       upstream connection is worth holding open.

       The popups overlay's socket is deliberately excluded. It
       only pushes cards into the lane and reads nothing, so
       counting it would keep four platform rooms alive feeding
       a client that ignores everything they send.
    --------------------------------------------------------- */
    if (url.pathname === "/clients") {
      return new Response(
        JSON.stringify({ count: this.consumerCount() }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    /* ---------------------------------------------------------
       Diagnostic: WHO is connected, not just how many.

       Rooms stay resident because this object reports a consumer.
       If a socket dies without a clean close — OBS killed, laptop
       asleep, network dropped — it can linger in getWebSockets()
       and keep every platform room awake indefinitely, which
       looks exactly like "the overlay was left open".

       Telling those apart needs the roles, not the count.
    --------------------------------------------------------- */
    if (url.pathname === "/sockets") {
      const sockets = this.state.getWebSockets().map((ws) => {
        let attachment = null;
        try { attachment = ws.deserializeAttachment(); } catch {}

        return {
          role: attachment?.role ?? "(none — pre-role socket)",
          readOnly: attachment?.readOnly ?? null,
          readyState: ws.readyState
        };
      });

      return new Response(
        JSON.stringify({
          total: sockets.length,
          consumers: this.consumerCount(),
          sockets
        }, null, 2),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }

  /* ---------------------------------------------------------
     ⭐ Incoming message from an overlay.

     Hibernation delivers these here instead of to an event
     listener. DO NOT echo back to the sender.
  --------------------------------------------------------- */
  async webSocketMessage(ws, message) {
    /* A viewer pop-out must not be able to put reward cards or
       stream alerts on the live overlay. */
    let attachment;
    try {
      attachment = ws.deserializeAttachment();
    } catch {
      attachment = null;
    }

    if (attachment?.readOnly) return;

    let parsed;

    try {
      parsed = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message)
      );
    } catch {
      // Non-JSON from a client is never meaningful — drop it.
      return;
    }

    // Heartbeats stay between the client and this object.
    if (parsed?.type === "ping") return;

    if (!RELAYABLE_TYPES.includes(parsed?.type)) {
      console.warn("Dropped non-relayable client message:", parsed?.type);
      return;
    }

    this.broadcast(scrub(parsed), ws);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch {}
    await this.announceIfEmpty(ws);
  }

  /* ---------------------------------------------------------
     Tell the platform rooms when the last overlay leaves.

     They used to find out by polling this object every 30
     seconds — four of them, staggered, which meant a wake here
     roughly every 7 seconds forever. Hibernation needs a quiet
     window, so this object never got one and billed duration
     around the clock whether anyone was watching or not.

     Inverting it costs one fanout on the last disconnect
     instead of ~11,500 polls a day, and lets this object sleep.

     The rooms keep their own grace period, so a page refresh
     doesn't tear down the upstream connections. They also still
     poll once every 5 minutes as a safety net in case this
     notification never lands — an eviction mid-close, a deploy.
  --------------------------------------------------------- */
  /* Sockets that actually read chat. The popups overlay's
     send-only socket doesn't count — see the /clients note. */
  consumerCount(excluding = null) {
    return this.state.getWebSockets().filter((ws) => {
      if (ws === excluding) return false;
      try {
        const a = ws.deserializeAttachment();

        /* Send-only: pushes cards in, reads nothing. */
        if (a?.role === "popups") return false;

        /* ---------------------------------------------------
           Read-only viewers on the public pop-out don't count
           either.

           They cannot start the platform rooms — the worker
           skips the wakes for them — but without this they
           could still KEEP them running: close your own
           overlay while a viewer has theirs open, and the
           rooms would never learn that nobody who matters is
           watching.

           Both halves are needed, exactly as with the popups
           socket. Either alone leaves the leak intact.
        --------------------------------------------------- */
        if (a?.readOnly) return false;

        return true;
      } catch {
        /* No attachment — a socket from before roles existed.
           Treat it as a viewer: over-counting keeps chat working,
           under-counting would silently kill it. */
        return true;
      }
    }).length;
  }

  async announceIfEmpty(closing) {
    /* The socket being closed can still appear in the list at
       this point, so exclude it rather than trusting length. */
    if (this.consumerCount(closing) > 0) return;

    const rooms = [
      [this.env.BeamRoom, "beam-unified-chat"],
      [this.env.ArenaRoom, "arena-live-chat"],
      [this.env.VPZoneRoom, "vpzone-live-chat"],
      [this.env.OdyseeRoom, "odysee-live-chat"],
      [this.env.BitChuteRoom, "bitchute-live-chat"],
      [this.env.FacebookRoom, "facebook-live-chat"]
    ];

    await Promise.allSettled(
      rooms.map(([ns, name]) => {
        if (!ns) return Promise.resolve();
        return ns.get(ns.idFromName(name)).fetch("https://do/idle");
      })
    );

    console.log("[ChatRoom] last overlay left — platform rooms notified");
  }

  async webSocketError(ws, error) {
    console.warn("[ChatRoom] socket error:", error?.message || error);
  }

  /* ---------------------------------------------------------
     ⭐ Broadcast to all connected overlay clients
     (except sender)
  --------------------------------------------------------- */
  broadcast(event, sender) {
    const sockets = this.state.getWebSockets();
    if (!sockets.length) return;

    const payload = JSON.stringify(event);

    for (const ws of sockets) {
      if (ws === sender) continue;   // ⭐ Never echo back to sender

      try {
        ws.send(payload);
      } catch {
        // Dead socket — the runtime will clean it up.
      }
    }
  }
}
