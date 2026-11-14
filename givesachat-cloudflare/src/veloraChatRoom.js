// givesachat-cloudflare/src/veloraChatRoom.js

import { getVeloraAccessToken } from "./veloraAuth.js";
import {
  transformVeloraSocketMessage,
  isBotMessage,
  socketMessageId
} from "./veloraSocketTransform.js";

/* ---------------------------------------------------------
   VeloraChatRoom — the bot-message gap filler.

   Velora chat arrives on the chat.message webhook and always
   has. That path is untouched and remains the source for every
   human message.

   The webhook has one hole: it does not deliver bot-authored
   messages. Proven 14 Nov 2026 rather than assumed — the author
   of every chat.message POST was logged while !mods was
   triggered live, and the bot's reply produced no POST at all
   while two human messages arrived by name.

   The Chat WebSocket does carry them, flagged with isBot.

   ⭐ SO THIS ROOM FORWARDS BOTS ONLY.

   The socket delivers EVERY message, including every human one
   the webhook is already delivering. Forwarding the lot would
   double-render all Velora chat — which is precisely the
   arena.social bug, and it took three attempts and a wrong
   "double relay" theory to find that one. Everything that is
   not a bot is dropped here, deliberately, at the earliest
   possible point.

   Protocol notes (Socket.IO over a raw WebSocket, same as
   bitchuteRoom.js, which is where this transport comes from):

     recv  0{"sid":…,"pingInterval":25000,…}   server hello
     send  40/chat,                            join the NAMESPACE
     recv  40/chat,{"sid":…}                   namespace ack
     send  42/chat,["joinChannel",{channelId}] SUBSCRIBE
     recv  42/chat,["newMessage",{…}]          a chat message
     recv  2                                   ping -> reply 3

   ⚠️ THE NAMESPACE IS NOT OPTIONAL, and it is not the default
   one. BitChute's socket uses the default namespace, so its
   frames are a bare "40" and "42[…]". Velora's chat lives at
   /chat, which means every frame carries "/chat," after the
   prefix. Velora's own docs call this out as the first thing to
   check when a socket connects and then dies within seconds —
   the server accepts the handshake and drops you because nothing
   is listening on the root.

   ⚠️ AUTHENTICATED IS NOT SUBSCRIBED — the same trap BitChute
   set. The token is accepted, the socket stays open, and no
   messages ever arrive until joinChannel is emitted. And per the
   docs, joinChannel is scoped to the SOCKET, not the user, so it
   must be re-emitted on every reconnect.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   ⭐ THE GATEWAY IS /socket.io/, NOT /chat.

   This was wrong first time and failed with a bare
   "gateway did not upgrade (status 504)", which looks like
   Velora being down and is not.

   The docs give the endpoint as wss://api.velora.tv/chat, but
   that is a SOCKET.IO-CLIENT CONNECTION STRING, not an HTTP
   address. Hand it to io() and the library splits it in two:

     host       api.velora.tv
     namespace  /chat

   and then opens the transport at its own default path,
   /socket.io/. Nothing is served at /chat over HTTP at all, so
   an upgrade aimed there hangs until Cloudflare's edge gives up
   — hence a timeout rather than a 404, which is what made it
   look like a Velora problem.

   Their own gotcha gives it away on a second reading: "if you
   connect to the root URL (wss://api.velora.tv/socket.io/) with
   no namespace…". That sentence only parses if /socket.io/ is
   the real endpoint and the namespace is a protocol step on top
   of it — which is exactly what the 40/chat, frame below does.

   BitChute's gateway is spelled .../socket.io/ for the same
   reason. The transport was copied from there; this detail was
   not.
--------------------------------------------------------- */
const GATEWAY = "wss://api.velora.tv/socket.io/";

/* The namespace prefix on every frame. Velora's chat lives on
   /chat, so this is NOT the bare "40"/"42[…]" that BitChute's
   default-namespace socket uses. */
const NS = "/chat,";

const ALARM_INTERVAL_MS = 30_000;
const IDLE_SHUTDOWN_MS = 120_000;
const TRAFFIC_GRACE_MS = 300_000;

/* Velora pings every 25s. Nothing at all for 90s means dead,
   whatever the socket still claims. */
const STALE_AFTER_MS = 90_000;

/* "Emit a heartbeat or a ping every 60-120s if your client is
   otherwise quiet." A read-only bot listener is about as quiet as
   a client gets, so this sits at the safe end. */
const HEARTBEAT_MS = 60_000;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

/* Dedupe ring. The socket can replay on reconnect, and a
   reconnect storm must not put the same bot reply in the lane
   three times. */
const MAX_RECENT_IDS = 200;

export class VeloraChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    /* Username or UUID — the docs say the server resolves both.
       The UUID is preferred because it cannot be changed by a
       rename, and we already hold it in config. */
    this.channelId =
      env?.VELORA_CHANNEL_ID || env?.VELORA_CHANNEL || null;

    this.running = false;
    this.ws = null;
    this.backoff = MIN_BACKOFF_MS;
    this.joined = false;

    this.connectedAt = null;
    this.lastFrameAt = null;
    this.lastMessageAt = null;
    this.lastHeartbeatAt = 0;

    this.recentIds = [];

    /* Counted separately, because "connected and silent" is
       ambiguous and these three numbers tell the cases apart:
       a socket receiving nothing at all, a socket receiving
       human chat but no bots, and a working bot relay. */
    this.framesSeen = 0;
    this.messagesSeen = 0;
    this.botsForwarded = 0;

    /* ⭐ The first newMessage frame, verbatim.

       The socket's payload shape is documented as a field LIST,
       not an example, and Velora has five different naming
       conventions for a user across its existing payloads. The
       transform therefore guesses with fallback chains. This
       records one real frame so the guess can be checked against
       the truth instead of trusted — the same reason the alert
       sampler exists, and it was written after two raid fixes
       were reasoned out from a test payload and both missed. */
    this.firstFrame = null;
    this.firstBotFrame = null;

    this.recentFrames = [];
    this.lastError = null;
    this.stoppedReason = null;

    this.liveGate = undefined;
    this.clientsPresent = true;
    this.lastClientSeenAt = Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/start")) {
      this.lastClientSeenAt = Date.now();
      this.clientsPresent = true;
      this.stoppedReason = null;
      this.ensureRunning();
      await this.scheduleAlarm();
      return this.json({ ok: true, running: this.running });
    }

    if (url.pathname.endsWith("/stop")) {
      this.stop("manual");
      return this.json({ ok: true, running: false });
    }

    /* ---------------------------------------------------------
       ⭐ FORCE A CODE RELOAD.

       A deploy does not replace a running Durable Object. This
       room runs a `while (this.running)` connect loop, so it
       never goes idle, never gets evicted, and keeps the module
       it booted with — while /version, a fresh worker
       invocation, cheerfully reports the new build. That has now
       produced three wrong diagnoses in this project: a missing
       Beam log blamed on tail buffering, an Arena duplicate
       blamed on a double relay, and a Velora socket 504 that
       looked like an unfixed bug after it had been fixed.

       Stopping is not enough on its own either: the 30-second
       alarm calls ensureRunning() straight back whenever the
       channel is live, so the object can never fall idle long
       enough to be recycled.

       So this does the three things that actually make eviction
       happen — stop the loop, close the socket, and DELETE the
       alarm so nothing wakes it — and then abort the object
       outright where the runtime supports it.
    --------------------------------------------------------- */
    if (url.pathname.endsWith("/recycle")) {
      this.stop("recycle");

      try { await this.state.storage.deleteAlarm(); } catch {}

      /* Guarded rather than assumed: abort() discards the object
         immediately and the next request builds a fresh one on
         current code. If this runtime does not have it, the
         deleted alarm above still gets us there, just slower. */
      if (typeof this.state.abort === "function") {
        try {
          this.state.abort("code reload requested");
        } catch { /* abort throws by design */ }
      }

      return this.json({ ok: true, recycled: true });
    }

    /* Live gate, pushed by the cron. Fails towards running: an
       unreadable body is treated as live, because losing bot
       messages mid-stream is worse than an idle room. */
    if (url.pathname.endsWith("/live")) {
      let live = true;
      let version = null;

      try {
        const body = await request.json();
        live = body?.live !== false;
        version = body?.version || null;
      } catch { /* assume live */ }

      /* ---------------------------------------------------------
         ⭐ SELF-HEAL ON A VERSION CHANGE.

         The supervisor already stamps every tick with the
         worker's VERSION. If it disagrees with the build this
         room booted on, the room is stale by definition — so it
         stands itself down and lets the next tick, two minutes
         later, start a fresh object on current code.

         ⚠️ It must NOT fall through to ensureRunning() below.
         BeamRoom's version check sets running = false and then
         the very next branch calls ensureRunning() again, which
         restarts the loop inside the SAME object and reloads
         nothing at all. The early return is the whole point.
      --------------------------------------------------------- */
      if (version) {
        this.bootVersion ||= version;

        if (this.bootVersion !== version) {
          console.log(
            `[VELORA-SOCKET] worker is ${version}, room booted on ` +
            `${this.bootVersion} — standing down for a reload`
          );

          this.bootVersion = version;
          this.stop("version-change");

          try { await this.state.storage.deleteAlarm(); } catch {}

          if (typeof this.state.abort === "function") {
            try { this.state.abort("version change"); } catch {}
          }

          return this.json({ ok: true, live, recycled: true });
        }
      }

      this.liveGate = live;

      if (live) {
        this.clientsPresent = true;
        this.lastClientSeenAt = Date.now();
        this.ensureRunning();
        await this.scheduleAlarm();
      }

      return this.json({ ok: true, live });
    }

    if (url.pathname.endsWith("/idle")) {
      this.clientsPresent = false;
      this.lastClientSeenAt = Date.now();
      return this.json({ ok: true });
    }

    if (url.pathname.endsWith("/status")) {
      return this.json({
        running: this.running,
        connected: !!this.ws,
        joined: this.joined,
        channelId: this.channelId,
        connectedAt: this.connectedAt,
        secondsSinceFrame: this.lastFrameAt
          ? Math.round((Date.now() - this.lastFrameAt) / 1000)
          : null,
        framesSeen: this.framesSeen,
        messagesSeen: this.messagesSeen,
        botsForwarded: this.botsForwarded,
        liveGate: this.liveGate ?? null,

        /* Which build this OBJECT booted on, which is not
           necessarily the build /version reports. When they
           disagree, that discrepancy is the bug. */
        bootVersion: this.bootVersion || null,

        stoppedReason: this.stoppedReason,
        lastError: this.lastError,

        /* The two frames worth having. */
        firstFrame: this.firstFrame,
        firstBotFrame: this.firstBotFrame,

        recentFrames: this.recentFrames
      });
    }

    return new Response("VeloraChatRoom", { status: 200 });
  }

  hasRecentTraffic() {
    return !!this.lastMessageAt &&
      Date.now() - this.lastMessageAt < TRAFFIC_GRACE_MS;
  }

  async alarm() {
    const idleFor = Date.now() - this.lastClientSeenAt;

    if (!this.hasRecentTraffic() &&
        (this.liveGate === false ||
         (!this.clientsPresent && idleFor > IDLE_SHUTDOWN_MS))) {
      if (this.running) console.log("[VELORA-SOCKET] offline — stopping");
      this.stop("idle");
      return;   // no alarm rescheduled: object can be evicted
    }

    if (this.ws &&
        this.lastFrameAt &&
        Date.now() - this.lastFrameAt > STALE_AFTER_MS) {
      console.warn("[VELORA-SOCKET] no frames for 90s — recycling");
      this.closeSocket();
    }

    /* Keeps a quiet session warm. The docs are explicit that a
       client which emits nothing for a long stretch may be
       dropped, and a read-only listener emits nothing at all. */
    if (this.ws && Date.now() - this.lastHeartbeatAt > HEARTBEAT_MS) {
      this.lastHeartbeatAt = Date.now();
      try { this.ws.send(`42${NS}["heartbeat",{}]`); } catch {}
    }

    this.ensureRunning();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    try {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    } catch (err) {
      console.error("[VELORA-SOCKET] setAlarm failed:", err);
    }
  }

  stop(reason) {
    this.running = false;
    this.stoppedReason = reason;
    this.closeSocket();
  }

  closeSocket() {
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.joined = false;
    this.connectedAt = null;
  }

  ensureRunning() {
    if (this.running) return;

    if (!this.channelId) {
      console.warn("[VELORA-SOCKET] no VELORA_CHANNEL_ID — not starting");
      return;
    }

    this.running = true;
    this.lastError = null;
    this.connectLoop();
  }

  async connectLoop() {
    while (this.running) {
      try {
        await this.connect();
        this.backoff = MIN_BACKOFF_MS;
      } catch (err) {
        this.lastError = String(err?.message || err);
        console.error("[VELORA-SOCKET] connect error:", this.lastError);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }

      if (!this.running) break;
      await new Promise((r) => setTimeout(r, this.backoff));
    }
  }

  async connect() {
    /* ---------------------------------------------------------
       A fresh token per connect, through the existing helper so
       refresh is handled in one place.

       "Access tokens are short-lived by design, so a bot that
       runs longer than a few minutes has to refresh. A token
       pasted into a config file by hand will stop working and is
       not a supported setup." — which is why this calls
       getVeloraAccessToken rather than reading a secret.
    --------------------------------------------------------- */
    const token = await getVeloraAccessToken(this.env);
    if (!token) throw new Error("no Velora access token (re-auth needed)");

    /* ⭐ The token goes in a HEADER, not the query string.

       The docs offer three methods and the query string is one of
       them. It is the wrong one: a credential in a URL lands in
       request logs, proxy logs and error traces along the way,
       and this one is an OAuth token for the whole channel. The
       Authorization header is checked the same way and leaks
       nowhere. */
    const fetchUrl =
      `${GATEWAY}?EIO=4&transport=websocket`.replace(/^wss:\/\//i, "https://");

    const res = await fetch(fetchUrl, {
      headers: {
        "Upgrade": "websocket",
        "Authorization": `Bearer ${token}`,
        "Origin": "https://velora.tv"
      }
    });

    const ws = res.webSocket;
    if (!ws) throw new Error(`gateway did not upgrade (status ${res.status})`);

    ws.accept();

    this.ws = ws;
    this.joined = false;
    this.connectedAt = Date.now();
    this.lastFrameAt = Date.now();
    this.lastHeartbeatAt = Date.now();

    return new Promise((resolve) => {
      ws.addEventListener("message", (event) => {
        this.lastFrameAt = Date.now();
        this.handlePacket(ws, event.data);
      });

      ws.addEventListener("close", (event) => {
        console.log(
          `[VELORA-SOCKET] closed: ${event.code} ${event.reason || ""}`
        );
        this.ws = null;
        this.joined = false;
        this.connectedAt = null;
        resolve();
      });

      ws.addEventListener("error", () => {
        this.ws = null;
        this.joined = false;
        resolve();
      });
    });
  }

  handlePacket(ws, raw) {
    const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

    if (data !== "2" && data !== "3") {
      this.framesSeen++;
      this.recentFrames.push({
        at: new Date().toISOString().slice(11, 19),
        frame: data.slice(0, 200)
      });
      if (this.recentFrames.length > 20) this.recentFrames.shift();
    }

    // Server hello — join the /chat namespace, NOT the default one.
    if (data.startsWith("0{")) {
      try { ws.send(`40${NS}`); } catch {}
      return;
    }

    if (data === "2") {
      try { ws.send("3"); } catch {}
      return;
    }

    /* Namespace ack. Being in the namespace is not being in the
       channel — without joinChannel this socket sits connected
       and authenticated and receives nothing at all. */
    if (data.startsWith("40")) {
      this.joinChannel(ws);
      return;
    }

    if (!data.startsWith("42")) return;

    /* 42/chat,["name",payload] — skip to the array. The segment
       between the prefix and the bracket is the namespace and an
       optional ack id; neither matters here. */
    const start = data.indexOf("[");
    if (start === -1) return;

    let name, payload;
    try {
      [name, payload] = JSON.parse(data.slice(start));
    } catch {
      return;
    }

    if (name === "newMessage") {
      this.handleMessage(payload);
      return;
    }

    /* commandResult is how the gateway reports a rejection, and
       it is the documented place to look when something is being
       blocked. We never send messages, so one arriving is worth
       surfacing rather than swallowing. */
    if (name === "commandResult") {
      console.warn(
        "[VELORA-SOCKET] commandResult:",
        JSON.stringify(payload).slice(0, 200)
      );
      return;
    }

    /* Everything else on this namespace — userJoined, userLeft,
       viewer_count_update, moderationNotice — is either already
       handled by the webhook or of no use to the chat lane.
       Counted in framesSeen, not logged: viewer_count_update
       alone would bury the tail. */
  }

  joinChannel(ws) {
    if (!this.channelId) {
      console.error("[VELORA-SOCKET] no channel id — cannot join");
      return;
    }

    try {
      ws.send(
        `42${NS}${JSON.stringify(["joinChannel", { channelId: this.channelId }])}`
      );
      this.joined = true;
      console.log(`[VELORA-SOCKET] joined channel ${this.channelId}`);
    } catch (err) {
      console.error("[VELORA-SOCKET] joinChannel failed:", err);
    }
  }

  async handleMessage(frame) {
    this.messagesSeen++;

    if (!this.firstFrame) {
      this.firstFrame = {
        at: new Date().toISOString(),
        frame: JSON.stringify(frame).slice(0, 1500)
      };
    }

    /* ---------------------------------------------------------
       ⭐ BOTS ONLY. Everything else is already in the lane via
       the webhook, and forwarding it would double-render every
       human message in Velora chat.
    --------------------------------------------------------- */
    if (!isBotMessage(frame)) return;

    if (!this.firstBotFrame) {
      this.firstBotFrame = {
        at: new Date().toISOString(),
        frame: JSON.stringify(frame).slice(0, 1500)
      };
    }

    /* Dedupe on Velora's own id. A reconnect that replays recent
       history must not repost a bot reply already in the lane. */
    const id = socketMessageId(frame);
    if (id) {
      if (this.recentIds.includes(id)) return;
      this.recentIds.push(id);
      if (this.recentIds.length > MAX_RECENT_IDS) this.recentIds.shift();
    }

    let payload;
    try {
      payload = await transformVeloraSocketMessage(frame, this.env);
    } catch (err) {
      console.error("[VELORA-SOCKET] transform failed:", err?.message || err);
      return;
    }

    if (!payload) return;

    this.lastMessageAt = Date.now();
    this.botsForwarded++;

    console.log(
      `[VELORA-SOCKET] bot forwarded: "${payload.username}" ` +
      `"${String(payload.html).replace(/<[^>]+>/g, "").slice(0, 60)}"`
    );

    await this.broadcast(payload);
  }

  async broadcast(payload) {
    try {
      const id = this.env.ChatRoom.idFromName("givesachat-main-v4");
      const room = this.env.ChatRoom.get(id);

      await room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
    } catch (err) {
      console.error("[VELORA-SOCKET] broadcast failed:", err);
    }
  }

  json(body) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}
