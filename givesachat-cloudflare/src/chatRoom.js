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

    /* ---------------------------------------------------------
       ⭐ NO CLIENT MAY CREATE A STREAM ALERT. THE WORKER OWNS IT.

       Settled by the logs, not by argument. The worker builds the
       correct card every time:

         [ALERT v3] type=raid name="net-TV" viewers=2

       and the lane still showed "Someone raided!". So the card on
       screen was never the worker's — it came from the popups
       overlay, whose Socket.IO payload has no raider name.

       The overlay was supposed to stop relaying unnamed alerts.
       That fix lives in a browser source which has not picked up
       new code across several deploys and refreshes, and waiting
       for a page to update is not a fix.

       So the permission is removed here instead. A client socket
       can no longer put a stream alert in the lane at all — not a
       stale one, not a future one, not a viewer's. The worker's
       named copy becomes the only alert that can exist.

       Reward cards are untouched: those carry real names and the
       overlay is the right place for them.
    --------------------------------------------------------- */
    if (parsed?.type === "velora_system") {
      console.log(
        `[ChatRoom] client alert refused (${parsed?.data?.alertType || "?"}) — ` +
        `the worker is the only source of stream alerts`
      );
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
  /* ---------------------------------------------------------
     ⭐ ONE ALERT, ONE CARD — WHOEVER SENT IT.

     Velora alerts reach the chat lane by two independent routes:
     the worker, from the channel.raid webhook, and the popups
     overlay, from its own Socket.IO feed. Neither knows about the
     other, so a raid produced two cards — and because the two
     feeds carry DIFFERENT SHAPES, the two cards disagreed:

       "Someone raided with 4 viewers!"   (overlay: count, no name)
       "Someone raided!"                  (worker: neither)

     Deduping inside either sender cannot work. The popups overlay
     already had a dedupe and it was helpless, because the second
     card was never its to suppress.

     This is the one place both routes meet, so this is where it
     belongs. Keyed on type and name over a short window: two
     genuine follows seconds apart still both render, and a raid
     that arrives twice does not.

     In-memory, so it resets when the object is evicted. That is
     fine — the window is seconds and eviction takes minutes.
  --------------------------------------------------------- */
  isDuplicateAlert(event) {
    if (event?.type !== "velora_system") return false;

    const d = event.data || {};

    /* ---------------------------------------------------------
       ⭐ EVERY ALERT THAT REACHES THIS POINT, WITH ITS VERDICT.

       Five attempts have each fixed a real bug and none has fixed
       the symptom. The reason is always the same: the reasoning
       moved faster than the evidence. The worker's log proves it
       builds name="Kluma" correctly, so the failure is downstream
       of that — and this is the only place both copies converge.

       So this prints EVERY copy: what it carries, and what was
       decided about it. Two lines from one raid and there is
       nowhere left for this to hide.
    --------------------------------------------------------- */
    const trace = (verdict) =>
      console.log(
        `[ALERT-TRACE] ${verdict} type=${d.alertType} ` +
        `name=${JSON.stringify(d.displayName || d.username || null)} ` +
        `viewers=${JSON.stringify(d.viewers ?? null)} ` +
        `msg=${JSON.stringify((d.message || "").slice(0, 40))}`
      );

    /* ---------------------------------------------------------
       ⭐ A NAMELESS ALERT IS NEVER THE ONE TO SHOW.

       Proven on a live raid. The worker built the right card:

         [ALERT] type=raid name="Kluma" viewers=1

       and ChatRoom threw it away, because the popups overlay's
       copy — which carries no raider name in its Socket.IO
       payload — had already arrived and taken the slot. Every
       raid read "Someone raided!" while the correct card was
       discarded a beat later as the duplicate.

       The overlay was supposed to stop relaying unnamed alerts.
       That fix is client-side, and a browser source that will not
       pick up a fresh module cannot be made to run it. Depending
       on a refresh happening is not a fix.

       So the rule moves server-side, where it cannot be dodged: an
       alert with no name and no sentence is dropped outright. It
       could only ever render as "Someone", and we now know a named
       copy follows from the worker.

       Alerts carrying a message but no name still pass — those
       render Velora's own wording, which is real content.
    --------------------------------------------------------- */
    const hasName = !!(d.displayName || d.username);
    const hasSentence = typeof d.message === "string" && d.message.trim();

    if (!hasName && !hasSentence) {
      trace("DROPPED-unnamed");
      return true;
    }
    const type = String(d.alertType || "alert");
    const name = String(d.displayName || d.username || "").toLowerCase();

    /* ---------------------------------------------------------
       Place is part of the identity of a claim.

       Velora emits both a redemption and a pointsCelebration for
       one claim, and this key is what collapses that pair. But
       without the place, one person claiming 1st and then 2nd
       inside the 8-second window looks like the same alert twice
       and the second card is thrown away.

       Empty for every other alert type, so raid, follow, sub and
       Volts keys are byte-for-byte what they were.
    --------------------------------------------------------- */
    const place = String(d.place || "").toLowerCase();
    const key = `${type}|${name}|${place}`;

    const now = Date.now();
    this._recentAlerts ||= new Map();

    for (const [k, at] of this._recentAlerts) {
      if (now - at > 8000) this._recentAlerts.delete(k);
    }

    /* A nameless copy matches a named one of the same type. The
       two routes disagree about the name, so requiring both to
       match is exactly what let the pair through before. */
    const clash =
      this._recentAlerts.has(key) ||
      [...this._recentAlerts.keys()].some((k) => {
        const [t, n] = k.split("|");
        return t === type && (!n || !name);
      });

    if (clash) {
      trace("SUPPRESSED-duplicate");
      return true;
    }

    this._recentAlerts.set(key, now);
    trace("SENT");
    return false;
  }

  broadcast(event, sender) {
    if (this.isDuplicateAlert(event)) return;

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
