// givesachat-cloudflare/src/bitchuteRoom.js

import { transformBitchuteMessage } from "./bitchuteTransform.js";

/* ---------------------------------------------------------
   BitChuteRoom

   BitChute chat is Socket.IO, which normally forces a client
   library and therefore the browser — that is why Blaze lives
   in the overlay. But Socket.IO over a raw WebSocket is just
   text frames with a numeric prefix, and the whole exchange is
   short enough to speak by hand. Captured live, in order:

     recv  0{"sid":"…","pingInterval":25000,"pingTimeout":20000}
     send  40                          join the default namespace
     recv  40{"sid":"…"}               namespace ack
     send  42["join_room","<channel>"] SUBSCRIBE — see below
     recv  42["display_name","…"]      the handle assigned to US
     recv  42["avatar","https://…"]    the avatar assigned to US
     recv  42["message",{…}]           a chat message
     recv  2                           ping  -> we must reply 3

   So it runs here rather than in the overlay, which keeps it
   consistent with Beam, Arena, VPZONE and Odysee.

   THE ROOM IS THE CHANNEL. Every frame reports
   roomId x7gWP4Vw8CXN — the channel — even though the pop-out
   URL carries a per-stream video id. No Odysee-style claim
   resolution needed for the chat itself.

   AUTHENTICATED IS NOT SUBSCRIBED. Without the join_room frame
   the socket connects, the token is accepted, an identity is
   issued for the right thread — and no messages ever arrive.
   No error, no close, nothing to search for. That frame was
   only ever visible in what their client SENDS, which is the
   half of a WebSocket capture it is easy to never look at.
--------------------------------------------------------- */

const GATEWAY = "wss://chat001.bitchute.com/socket.io/";
const POPCHAT = "https://www.bitchute.com/popChat/";

/* Where the signed socket token comes from. Found by listing the
   pop-out page's XHRs rather than by guessing: this is the chat
   app's own endpoint, and it hands back the token in `auth`.

   POST { video_id } ->
     { url, thread_id, profile_id, profile_thumbnail_url,
       cf_is_admin, is_admin, is_supporter, membership_level,
       auth: "<base64> <sha256> <unix-ts>" }

   No cookie, no account, no key. Logged out it returns an
   anonymous token, which is all a read-only overlay needs. */
const AUTH_ENDPOINT =
  "https://api.bitchute.com/api/beta/apps/commentfreely/video";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const ALARM_INTERVAL_MS = 30_000;
const IDLE_SHUTDOWN_MS = 120_000;

/* Safety-net interval for the ChatRoom client-count check.
   Presence is normally pushed, so this is a fallback only. */
const CLIENT_RECHECK_MS = 300_000;

/* The server pings every 25s and times out at 20s. If nothing
   at all arrives in 90s the connection is dead regardless. */
const STALE_AFTER_MS = 90_000;

/* Tokens are timestamped. The validity window is unknown, so
   refetch well inside anything plausible rather than waiting to
   be disconnected. */
const TOKEN_TTL_MS = 10 * 60 * 1000;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

/* ---------------------------------------------------------
   The auth token

   Three space-separated parts: a base64 JSON payload, a SHA-256
   signature, and a unix issued-at.

     eyJwcm9maWxlX2lk… 95102c3f…d182c7d 1787050275

   The payload is byte-identical on every fetch; only the
   signature and timestamp change. The signature is NOT an
   unkeyed hash of the payload and timestamp — a dozen
   concatenation orders were tried against two captures and none
   matched — so it is HMAC'd with a key on their side and cannot
   be forged. Fetching a real one is the only route.

   Validated against this before use, so a changed response shape
   fails loudly here rather than as a mystery socket close.
--------------------------------------------------------- */
const TOKEN_RE =
  /^eyJwcm9maWxlX2lk[A-Za-z0-9+/=]+\s+[0-9a-f]{64}\s+\d{10}$/;

export class BitChuteRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.videoId = env?.BITCHUTE_VIDEO_ID || null;

    this.running = false;
    this.ws = null;
    this.backoff = MIN_BACKOFF_MS;

    this.token = null;
    this.tokenFetchedAt = 0;
    this.threadId = null;

    /* Read out of the token payload rather than configured. The
       token is minted for this thread, so its channel_id is by
       definition the room we are entitled to join — a config var
       could drift out of step with it and silently join nothing. */
    this.channelId = env?.BITCHUTE_CHANNEL_ID || null;

    this.connectedAt = null;
    this.lastFrameAt = null;

    /* Ring of recent non-keepalive frames, for /status. Being
       connected with messageCount 0 is ambiguous — it could be a
       quiet room, an event name we don't handle, or a room we
       were never joined to. This tells them apart. */
    this.recentFrames = [];
    this.messageCount = 0;
    this.lastError = null;
    this.stoppedReason = null;
    this.lastClientSeenAt = Date.now();

    /* Presence is pushed by ChatRoom. Assume someone is
       watching until told otherwise — the safety net below
       corrects it if that assumption is wrong. */
    this.clientsPresent = true;
    this.lastClientCheckAt = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/start")) {
      this.lastClientSeenAt = Date.now();
      this.clientsPresent = true;
      this.stoppedReason = null;
      this.ensureRunning();
      return this.json({ ok: true, running: this.running });
    }

    if (url.pathname.endsWith("/stop")) {
      this.stop("manual");
      return this.json({ ok: true, running: false });
    }

    /* Pushed by ChatRoom when its last overlay disconnects. */
    if (url.pathname.endsWith("/idle")) {
      this.clientsPresent = false;
      this.lastClientSeenAt = Date.now();
      return this.json({ ok: true });
    }

    if (url.pathname.endsWith("/status")) {
      return this.json({
        running: this.running,
        videoId: this.videoId,
        connected: !!this.ws,
        connectedAt: this.connectedAt,
        secondsSinceFrame: this.lastFrameAt
          ? Math.round((Date.now() - this.lastFrameAt) / 1000)
          : null,
        hasToken: !!this.token,
        threadId: this.threadId,
        channelId: this.channelId,
        tokenAgeSeconds: this.tokenFetchedAt
          ? Math.round((Date.now() - this.tokenFetchedAt) / 1000)
          : null,
        messageCount: this.messageCount,
        stoppedReason: this.stoppedReason,
        lastError: this.lastError,
        recentFrames: this.recentFrames
      });
    }

    return new Response("BitChuteRoom", { status: 200 });
  }

  /* The signed payload is the source of truth for which room we
     are entitled to join, so this is load-bearing rather than
     just diagnostic. Returns null on anything unparseable — the
     caller treats that as "no channel" and refuses to join. */
  describeToken(token) {
    try {
      const payload = decodeURIComponent(token.split(/[\s]|%20/)[0]);
      const json = JSON.parse(atob(payload));
      return {
        profile_id: json.profile_id,
        display_name: json.display_name,
        channel_id: json.channel_id,
        thread_id: json.thread_id,
        is_admin: json.is_admin
      };
    } catch {
      return null;
    }
  }

  async fetchToken(force = false) {
    if (!force && this.token && Date.now() - this.tokenFetchedAt < TOKEN_TTL_MS) {
      return this.token;
    }

    if (!this.videoId) throw new Error("BITCHUTE_VIDEO_ID not configured");

    const res = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Origin": "https://www.bitchute.com",
        "Referer": `${POPCHAT}${this.videoId}`
      },
      body: JSON.stringify({ video_id: this.videoId }),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) throw new Error(`commentfreely/video -> ${res.status}`);

    const json = await res.json();
    const token = typeof json?.auth === "string" ? json.auth.trim() : null;

    if (!token || !TOKEN_RE.test(token)) {
      this.lastError = "auth field missing or unrecognised";
      console.warn(
        "[BITCHUTE] no usable token in commentfreely response;",
        "keys:",
        Object.keys(json || {}).join(",")
      );
      return null;
    }

    /* thread_id is bc_<videoId>. If it ever disagrees with the
       video we asked about, we are authenticating against the
       wrong stream — which would connect fine and deliver
       nothing, the worst kind of failure. */
    if (json.thread_id && json.thread_id !== `bc_${this.videoId}`) {
      console.warn(
        `[BITCHUTE] token thread ${json.thread_id} != bc_${this.videoId}`
      );
    }

    this.token = token;
    this.tokenFetchedAt = Date.now();
    this.threadId = json.thread_id || null;

    /* The room to join lives in the signed payload. */
    const decoded = this.describeToken(token);
    if (decoded?.channel_id) this.channelId = decoded.channel_id;

    return this.token;
  }

  async alarm() {
    await this.refreshClientPresence();

    const idleFor = Date.now() - this.lastClientSeenAt;

    if (!this.clientsPresent && idleFor > IDLE_SHUTDOWN_MS) {
      if (this.running) console.log("[BITCHUTE] no overlays — stopping");
      this.stop("idle");
      return;   // no alarm rescheduled: object can be evicted
    }

    if (
      this.ws &&
      this.lastFrameAt &&
      Date.now() - this.lastFrameAt > STALE_AFTER_MS
    ) {
      console.warn("[BITCHUTE] no frames for 90s — recycling connection");
      this.closeSocket();
    }

    this.ensureRunning();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    try {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    } catch (err) {
      console.error("[BITCHUTE] setAlarm failed:", err);
    }
  }

  /* ---------------------------------------------------------
     Presence is PUSHED by ChatRoom — see the /idle route. This
     is only a safety net, so it runs every 5 minutes rather
     than every 30 seconds, which is what lets ChatRoom sleep.
  --------------------------------------------------------- */
  async refreshClientPresence() {
    const now = Date.now();
    if (now - this.lastClientCheckAt < CLIENT_RECHECK_MS) return;

    this.lastClientCheckAt = now;

    const count = await this.overlayCount();
    if (count === null) return;   // unknown — leave state as it was

    this.clientsPresent = count > 0;
    if (count > 0) this.lastClientSeenAt = now;
  }

  async overlayCount() {
    try {
      const id = this.env.ChatRoom.idFromName("givesachat-main-v4");
      const room = this.env.ChatRoom.get(id);

      const res = await room.fetch("https://dummy/clients");
      if (!res.ok) return null;

      const json = await res.json();
      return Number(json?.count ?? 0);
    } catch {
      return null;
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
    this.connectedAt = null;
  }

  ensureRunning() {
    if (this.running) return;
    if (!this.videoId) {
      console.warn("[BITCHUTE] BITCHUTE_VIDEO_ID not configured");
      return;
    }

    this.running = true;
    this.lastError = null;

    this.connectLoop();
    this.scheduleAlarm();
  }

  async connectLoop() {
    while (this.running) {
      try {
        await this.connect();
        this.backoff = MIN_BACKOFF_MS;
      } catch (err) {
        this.lastError = String(err?.message || err);
        console.error("[BITCHUTE] connect error:", this.lastError);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }

      if (!this.running) break;
      await new Promise((r) => setTimeout(r, this.backoff));
    }
  }

  async connect() {
    /* A fresh token each connect. They are timestamped, and a
       reconnect after a long gap with a stale one would fail in
       a way that looks like the socket is broken. */
    const token = await this.fetchToken(true);
    if (!token) throw new Error("no auth token");

    /* Fully percent-encoded, unlike the browser's URL which
       leaves the base64 raw. A base64 payload can contain "+",
       and "+" in a query string decodes to a space on nearly
       every server — which would corrupt the signature check in
       a way that looks like a rejected token. */
    const url =
      `${GATEWAY}?cf_auth=${encodeURIComponent(token)}` +
      `&EIO=4&transport=websocket`;

    /* Cloudflare performs the upgrade over http(s); wss:// fails
       outright with "Fetch API cannot load". */
    const fetchUrl = url.replace(/^wss:\/\//i, "https://");

    const res = await fetch(fetchUrl, {
      headers: {
        "Upgrade": "websocket",
        /* The gateway checks Origin — it is echoed back in
           access-control-allow-origin on the real handshake. */
        "Origin": "https://www.bitchute.com"
      }
    });

    const ws = res.webSocket;
    if (!ws) throw new Error(`gateway did not upgrade (status ${res.status})`);

    ws.accept();

    this.ws = ws;
    this.connectedAt = Date.now();
    this.lastFrameAt = Date.now();

    return new Promise((resolve) => {
      ws.addEventListener("message", (event) => {
        this.lastFrameAt = Date.now();
        this.handlePacket(ws, event.data);
      });

      ws.addEventListener("close", (event) => {
        console.log(`[BITCHUTE] socket closed: ${event.code} ${event.reason || ""}`);
        this.ws = null;
        this.connectedAt = null;
        resolve();
      });

      ws.addEventListener("error", () => {
        this.ws = null;
        resolve();
      });
    });
  }

  /* ---------------------------------------------------------
     engine.io / socket.io packet handling

     The numeric prefix is the whole protocol:

       0  open      server hello, carries sid and ping timings
       2  ping      must be answered with 3, or we get dropped
       3  pong
       40 connect   namespace handshake, both directions
       42 event     ["<name>", <payload>]
  --------------------------------------------------------- */
  handlePacket(ws, raw) {
    const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

    /* Keepalives are noise; everything else goes in the ring for
       /status. Not logged to the console — a line per message
       would bury every other platform in the tail, and the ring
       answers the same question on demand. */
    if (data !== "2" && data !== "3") {
      this.recentFrames.push({
        at: new Date().toISOString().slice(11, 19),
        frame: data.slice(0, 200)
      });
      if (this.recentFrames.length > 20) this.recentFrames.shift();
    }

    // Server hello — reply by joining the default namespace.
    if (data.startsWith("0{")) {
      try { ws.send("40"); } catch {}
      return;
    }

    // Keepalive. Miss these and the server closes the socket.
    if (data === "2") {
      try { ws.send("3"); } catch {}
      return;
    }

    /* ---------------------------------------------------------
       Namespace ack. Being in the namespace is NOT being in the
       room — without this the socket authenticates, is issued a
       display name and an avatar, and then receives nothing at
       all while messages fly past. Connected, no error, no data.

       The room key is the CHANNEL id, matching the roomId that
       comes back on every message frame.
    --------------------------------------------------------- */
    if (data.startsWith("40")) {
      if (!this.channelId) {
        console.error("[BITCHUTE] no channel id — cannot join room");
        return;
      }

      try {
        ws.send(`42["join_room",${JSON.stringify(this.channelId)}]`);
        console.log(`[BITCHUTE] joined room ${this.channelId}`);
      } catch (err) {
        console.error("[BITCHUTE] join_room failed:", err);
      }
      return;
    }

    if (!data.startsWith("42")) return;

    /* 42["name",payload] — the digits between 42 and [ are an
       optional ack id, which the server does not use for these
       events but which costs nothing to tolerate. */
    const start = data.indexOf("[");
    if (start === -1) return;

    let name, payload;

    try {
      [name, payload] = JSON.parse(data.slice(start));
    } catch {
      return;
    }

    if (name !== "message") {
      /* "avatar" and "display_name" arrive on connect and
         describe OUR OWN anonymous identity — the random handle
         the server assigns a guest, not the author of anything.
         Neither is of any use to a read-only overlay.

         Anything else is worth surfacing rather than swallowing. */
      if (name !== "avatar" && name !== "display_name") {
        console.log("[BITCHUTE] unhandled event:", String(name).slice(0, 40));
      }
      return;
    }

    this.handleMessage(payload);
  }

  async handleMessage(frame) {
    const payload = transformBitchuteMessage(frame);
    if (!payload) return;

    /* Guard against a history replay on connect. BitChute has
       not been seen to replay, but every other platform in this
       project does, and a backlog dumped into the lane mid
       stream is worse than a dropped message. */
    if (this.connectedAt && payload.timestamp < this.connectedAt - 30_000) {
      return;
    }

    this.messageCount++;
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
      console.error("[BITCHUTE] broadcast failed:", err);
    }
  }

  json(body) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}
