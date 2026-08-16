// givesachat-cloudflare/src/beamRoom.js

import { transformBeamMessage } from "./beamTransform.js";
import { resolveKickAvatar } from "./kickAvatars.js";

/* ---------------------------------------------------------
   BeamRoom

   Holds a single long-lived SSE connection to Beam's unified
   chat and forwards messages into ChatRoom, which fans them
   out to the overlays.

   The connection lives here rather than in the browser for
   three reasons: Beam is unlikely to permit cross-origin
   EventSource, one shared connection beats one per OBS source
   and iPad, and arriving via the worker means Beam traffic
   passes through the same sanitiser as everything else.

   Beam's stream is read-only and needs no token today. When
   the public API lands, an Authorization header goes in
   connect() and nothing else has to change.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   Stream URL

   Teodor: this moves from /chat-ng/ to /chat/ eventually, with
   both live for a month or two after the switchover. Set the
   BEAM_SSE_URL var in wrangler.jsonc to change it without
   touching code:

     "vars": { "BEAM_SSE_URL": "https://beamstream.gg/api/chat/..." }
--------------------------------------------------------- */
const BEAM_ROOM_ID = "625942989834817536";
const DEFAULT_BEAM_SSE_URL =
  `https://beamstream.gg/api/chat-ng/api/v1/rooms/${BEAM_ROOM_ID}/stream`;

const ALARM_INTERVAL_MS = 30_000;   // keepalive / supervisor tick

/* Durable Objects bill wall-clock duration while they are alive, and
   an open SSE connection keeps this one alive permanently. Left
   running it would bill ~10,800 GB-sec a day whether or not anyone is
   streaming — roughly 324,000 GB-sec a month against a 400,000 free
   allowance, before ChatRoom and PopupRoom are counted at all.

   So: stop reading when no overlay is connected. The next overlay to
   connect calls /start via wakeBeam() and it picks straight back up. */
const IDLE_SHUTDOWN_MS = 120_000;   // no overlays for 2 min -> stop
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export class BeamRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.running = false;
    this.backoff = MIN_BACKOFF_MS;
    this.sseUrl = env?.BEAM_SSE_URL || DEFAULT_BEAM_SSE_URL;

    // slug -> { url, expiresAt }. Lives as long as this object;
    // repopulates by itself after an eviction.
    this.kickAvatarCache = new Map();

    // Diagnostics, surfaced by /beam/status
    this.connectedAt = null;
    this.lastEventAt = null;
    this.lastError = null;
    this.messageCount = 0;
    this.droppedCount = 0;
    this.lastClientSeenAt = Date.now();
    this.stoppedReason = null;
  }

  /* ---------------------------------------------------------
     Is anyone actually watching? ChatRoom is the authority —
     it holds the overlay WebSockets.
  --------------------------------------------------------- */
  async overlayCount() {
    try {
      const id = this.env.ChatRoom.idFromName("givesachat-main-v4");
      const room = this.env.ChatRoom.get(id);

      const res = await room.fetch("https://dummy/clients");
      if (!res.ok) return null;

      const json = await res.json();
      return Number(json?.count ?? 0);
    } catch (err) {
      console.error("[BEAM] client count failed:", err);
      return null;   // unknown — err on the side of staying up
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/start")) {
      this.lastClientSeenAt = Date.now();
      this.stoppedReason = null;
      this.ensureRunning();
      return this.json({ ok: true, running: this.running });
    }

    if (url.pathname.endsWith("/stop")) {
      this.running = false;
      return this.json({ ok: true, running: false });
    }

    if (url.pathname.endsWith("/status")) {
      return this.json({
        running: this.running,
        connectedAt: this.connectedAt,
        lastEventAt: this.lastEventAt,
        secondsSinceLastEvent: this.lastEventAt
          ? Math.round((Date.now() - this.lastEventAt) / 1000)
          : null,
        messageCount: this.messageCount,
        droppedCount: this.droppedCount,
        lastError: this.lastError,
        stoppedReason: this.stoppedReason,
        secondsSinceOverlaySeen:
          Math.round((Date.now() - this.lastClientSeenAt) / 1000),
        sourceUrl: this.sseUrl
      });
    }

    return new Response("BeamRoom", { status: 200 });
  }

  /* ---------------------------------------------------------
     Supervisor. Durable Objects are evicted when idle, so the
     alarm both keeps this one resident and restarts the reader
     if the loop ever fell over.
  --------------------------------------------------------- */
  async alarm() {
    const count = await this.overlayCount();

    if (count !== null && count > 0) this.lastClientSeenAt = Date.now();

    const idleFor = Date.now() - this.lastClientSeenAt;

    if (count === 0 && idleFor > IDLE_SHUTDOWN_MS) {
      if (this.running) {
        console.log(
          `[BEAM] no overlays for ${Math.round(idleFor / 1000)}s — stopping`
        );
      }

      this.running = false;
      this.stoppedReason = "idle";

      // No alarm rescheduled: nothing left to supervise, so the
      // object can be evicted and stops billing entirely.
      return;
    }

    this.ensureRunning();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    try {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    } catch (err) {
      console.error("[BEAM] setAlarm failed:", err);
    }
  }

  ensureRunning() {
    if (this.running) return;

    this.running = true;
    this.lastError = null;

    // Deliberately not awaited — this runs for the lifetime of
    // the object. Failures are handled inside the loop.
    this.readLoop();
    this.scheduleAlarm();
  }

  async readLoop() {
    while (this.running) {
      try {
        await this.connect();

        // A clean end of stream is normal; reconnect promptly.
        this.backoff = MIN_BACKOFF_MS;
      } catch (err) {
        this.lastError = String(err?.message || err);
        console.error("[BEAM] stream error:", this.lastError);

        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }

      if (!this.running) break;
      await new Promise((r) => setTimeout(r, this.backoff));
    }
  }

  async connect() {
    const res = await fetch(this.sseUrl, {
      headers: {
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache"
      }
    });

    if (!res.ok) throw new Error(`Beam SSE returned ${res.status}`);
    if (!res.body) throw new Error("Beam SSE returned no body");

    this.connectedAt = Date.now();
    this.backoff = MIN_BACKOFF_MS;
    console.log("[BEAM] connected to unified chat stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (this.running) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        await this.handleFrame(frame);
      }

      // Guard against a peer that never sends a frame boundary.
      if (buffer.length > 1_000_000) buffer = "";
    }

    try { reader.cancel(); } catch {}
  }

  /* ---------------------------------------------------------
     One SSE frame, e.g.

       event: messages
       id: 8760420...
       data: {"id":"...","senderType":"kick",...}
  --------------------------------------------------------- */
  async handleFrame(frame) {
    let eventName = "message";
    const dataLines = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;              // comment
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    if (!dataLines.length) return;

    this.lastEventAt = Date.now();

    // init and keepalive carry no chat content.
    if (eventName !== "messages") return;

    let raw;
    try {
      raw = JSON.parse(dataLines.join("\n"));
    } catch {
      console.warn("[BEAM] unparseable frame data");
      return;
    }

    // A frame may carry one message or a batch.
    const items = Array.isArray(raw) ? raw : [raw];

    for (const item of items) {
      const payload = transformBeamMessage(item);

      if (!payload) {
        this.droppedCount++;
        continue;
      }

      // Kick doesn't come with an avatar — fill it in from
      // Kick's public API, cached per user.
      if (payload.platform === "kick" && !payload.avatar && payload.profileUrl) {
        payload.avatar = await resolveKickAvatar(
          payload.profileUrl,
          this.kickAvatarCache
        );
      }

      this.messageCount++;
      await this.broadcast(payload);
    }
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
      console.error("[BEAM] broadcast failed:", err);
    }
  }

  json(body) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}
