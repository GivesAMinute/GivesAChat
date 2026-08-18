// givesachat-cloudflare/src/vpzoneRoom.js

import { transformVpzoneFrame, safeVpzoneAsset } from "./vpzoneTransform.js";

/* ---------------------------------------------------------
   VPZoneRoom

   VPZONE's gateway is a plain WebSocket — not Socket.IO — so
   unlike Blaze this can run inside the worker, and unlike
   Arena there is no polling. Anonymous connections are
   explicitly supported and read-only, which is exactly what an
   overlay wants: no token, no rotation, no credential stored.

     wss://chat.vpzone.tv/ws?channel=<slug>

   Two details from their docs that matter:

   HISTORY REPLAY. On connect the server replays recent history
   (the active stream session, or the last hour). Left alone
   that would dump the backlog into the lane the moment an
   overlay connects — the same trap Arena set. Passing
   `since=<now>` makes the server skip it, and frames older than
   the connection are dropped as a second line of defence.

   PRESENCE AS KEEPALIVE. A `presence` frame arrives whenever
   the viewer count changes and at least every 30s regardless,
   so it doubles as a liveness signal — if one hasn't arrived in
   90s the connection is dead and worth recycling.
--------------------------------------------------------- */

const GATEWAY = "wss://chat.vpzone.tv/ws";
const API_BASE = "https://vpzone.tv/api/v1";

const ALARM_INTERVAL_MS = 30_000;
const IDLE_SHUTDOWN_MS = 120_000;

/* Safety-net interval for the ChatRoom client-count check.
   Presence is normally pushed, so this is a fallback only. */
const CLIENT_RECHECK_MS = 300_000;
const STALE_AFTER_MS = 90_000;      // no presence frame => assume dead

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

// Close codes we must not hammer on. 1008 means banned or a bad
// slug — retrying is pointless and rude.
const FATAL_CLOSE_CODES = new Set([1008]);

const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
const AVATAR_FAIL_TTL_MS = 10 * 60 * 1000;
const MAX_AVATARS = 500;

export class VPZoneRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.channel = env?.VPZONE_CHANNEL || null;

    this.running = false;
    this.ws = null;
    this.backoff = MIN_BACKOFF_MS;
    this.fatal = null;

    this.avatarCache = new Map();

    this.connectedAt = null;
    this.lastFrameAt = null;
    this.messageCount = 0;
    this.viewerCount = null;
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

    /* Pushed by ChatRoom the moment its last overlay
       disconnects. This replaces asking ChatRoom every 30
       seconds — four rooms doing that kept ChatRoom permanently
       resident and billing, which was the whole problem.

       The grace period still applies from here, so a page
       refresh doesn't tear the upstream connection down. */
    if (url.pathname.endsWith("/idle")) {
      this.clientsPresent = false;
      this.lastClientSeenAt = Date.now();
      return this.json({ ok: true });
    }

    if (url.pathname.endsWith("/status")) {
      return this.json({
        running: this.running,
        channel: this.channel,
        connected: !!this.ws,
        connectedAt: this.connectedAt,
        secondsSinceFrame: this.lastFrameAt
          ? Math.round((Date.now() - this.lastFrameAt) / 1000)
          : null,
        viewerCount: this.viewerCount,
        messageCount: this.messageCount,
        avatarsCached: this.avatarCache.size,
        avatarsEnabled: !!this.env.VPZONE_API_KEY,
        fatal: this.fatal,
        stoppedReason: this.stoppedReason,
        lastError: this.lastError
      });
    }

    return new Response("VPZoneRoom", { status: 200 });
  }

  async alarm() {
    await this.refreshClientPresence();

    if (!this.clientsPresent && Date.now() - this.lastClientSeenAt > IDLE_SHUTDOWN_MS) {
      this.stop("idle");
      return;   // no alarm rescheduled — object can be evicted
    }

    // Presence doubles as a keepalive; silence means a dead socket.
    if (
      this.ws &&
      this.lastFrameAt &&
      Date.now() - this.lastFrameAt > STALE_AFTER_MS
    ) {
      console.warn("[VPZONE] no frames for 90s — recycling connection");
      this.closeSocket();
    }

    this.ensureRunning();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    try {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    } catch (err) {
      console.error("[VPZONE] setAlarm failed:", err);
    }
  }

  /* ---------------------------------------------------------
     Presence is PUSHED by ChatRoom now — see the /idle route.
     This is only a safety net for a notification that never
     arrived (an eviction mid-close, a deploy), so it runs every
     5 minutes instead of every 30 seconds.

     That single change is what lets ChatRoom hibernate.
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
    if (!this.channel) {
      console.warn("[VPZONE] VPZONE_CHANNEL not configured");
      return;
    }
    if (this.fatal) return;   // banned / bad slug — do not retry

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
        console.error("[VPZONE] connect error:", this.lastError);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }

      if (!this.running || this.fatal) break;
      await new Promise((r) => setTimeout(r, this.backoff));
    }
  }

  /**
   * Opens the gateway socket and resolves when it closes.
   */
  async connect() {
    /* since=<now> tells the gateway to skip the history replay.
       Without it, every overlay connection would repaint the
       backlog into the lane. */
    const url =
      `${GATEWAY}?channel=${encodeURIComponent(this.channel)}` +
      `&since=${Date.now()}`;

    /* Cloudflare's fetch performs the upgrade over http(s) and
       hands back res.webSocket — passing a ws:// or wss:// URL
       fails with "Fetch API cannot load". The gateway constant
       keeps the documented wss:// form for readability, so
       swap the scheme here. */
    const fetchUrl = url.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");

    const res = await fetch(fetchUrl, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;

    if (!ws) throw new Error(`gateway did not upgrade (status ${res.status})`);

    ws.accept();

    this.ws = ws;
    this.connectedAt = Date.now();
    this.lastFrameAt = Date.now();
    console.log(`[VPZONE] connected to #${this.channel}`);

    return new Promise((resolve) => {
      ws.addEventListener("message", (event) => {
        this.lastFrameAt = Date.now();
        this.handleFrame(event.data);
      });

      ws.addEventListener("close", (event) => {
        console.log(`[VPZONE] socket closed: ${event.code} ${event.reason || ""}`);

        if (FATAL_CLOSE_CODES.has(event.code)) {
          /* 1008 = invalid slug, or banned from the channel.
             Their docs are explicit: do not retry while banned. */
          this.fatal = `closed ${event.code}: ${event.reason || "banned or invalid channel"}`;
          this.running = false;
          console.error("[VPZONE] fatal:", this.fatal);
        }

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

  async handleFrame(raw) {
    let frame;

    try {
      frame = JSON.parse(
        typeof raw === "string" ? raw : new TextDecoder().decode(raw)
      );
    } catch {
      return;
    }

    // Viewer count, and the gateway's own keepalive.
    if (frame.type === "presence") {
      this.viewerCount = Number(frame.count ?? 0);
      return;
    }

    /* Belt and braces against history replay: `since` should
       already have suppressed it, but a frame older than this
       connection is backlog either way. */
    if (this.connectedAt && Number(frame.ts) && frame.ts < this.connectedAt) {
      return;
    }

    const payload = transformVpzoneFrame(frame);
    if (!payload) return;

    payload.avatar = await this.avatarFor(frame.username);

    this.messageCount++;
    await this.broadcast(payload);
  }

  /* ---------------------------------------------------------
     Avatars

     Chat frames carry no avatar. /users/{username} has one but
     appears to require an API key, so this is optional: without
     VPZONE_API_KEY set, messages simply render without a
     picture rather than the integration failing.
  --------------------------------------------------------- */
  async avatarFor(username) {
    if (!this.env.VPZONE_API_KEY) return null;
    if (!username || typeof username !== "string") return null;

    const key = username.toLowerCase();
    const now = Date.now();
    const hit = this.avatarCache.get(key);

    if (hit && now < hit.expiresAt) return hit.url;

    if (this.avatarCache.size >= MAX_AVATARS) {
      this.avatarCache.delete(this.avatarCache.keys().next().value);
    }

    let url = null;

    try {
      const res = await fetch(`${API_BASE}/users/${encodeURIComponent(key)}`, {
        headers: {
          "Authorization": `Bearer ${this.env.VPZONE_API_KEY}`,
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(2000)
      });

      if (res.ok) {
        const json = await res.json();
        url = safeVpzoneAsset(json?.data?.avatar_url);
      } else {
        console.warn(`[VPZONE] avatar lookup ${key} -> ${res.status}`);
      }
    } catch (err) {
      console.warn(`[VPZONE] avatar lookup ${key} failed:`, String(err?.message || err));
    }

    this.avatarCache.set(key, {
      url,
      expiresAt: now + (url ? AVATAR_TTL_MS : AVATAR_FAIL_TTL_MS)
    });

    return url;
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
      console.error("[VPZONE] broadcast failed:", err);
    }
  }

  json(body) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}
