// givesachat-cloudflare/src/arenaRoom.js

import { transformArenaHistory } from "./arenaTransform.js";

/* ---------------------------------------------------------
   ArenaRoom

   Arena has no push transport we can use anonymously — their
   Socket.IO endpoint refuses unauthenticated connections — so
   this polls the public chat history and forwards new messages
   into ChatRoom.

   Two polls at different rates:

     info   is this handle live, and what is the livestream id
     chat   the message history for that livestream

   Nothing is polled while the channel is offline, and nothing
   is polled while no overlay is connected — same idle
   shutdown as BeamRoom, for the same billing reason.
--------------------------------------------------------- */

const ARENA_API = "https://api.arena.social";

const CHAT_POLL_MS = 4_000;        // while live
const INFO_POLL_MS = 60_000;       // checking whether we went live
const ALARM_INTERVAL_MS = 30_000;
const IDLE_SHUTDOWN_MS = 120_000;
const TRAFFIC_GRACE_MS = 300_000;  // 5 min of real messages holds the room open

/* Safety-net interval for the ChatRoom client-count check.
   Presence is normally pushed, so this is a fallback only. */
const CLIENT_RECHECK_MS = 300_000;

// Guards against unbounded growth on a long stream. Well above
// any single history response.
const MAX_SEEN_IDS = 2_000;

export class ArenaRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.handle = env?.ARENA_HANDLE || null;

    this.running = false;
    this.livestreamId = null;
    this.isLive = false;

    // Message ids already forwarded. Seeded on the first poll so
    // that connecting mid-stream does not dump the entire backlog
    // into the overlay at once.
    this.seen = new Set();
    this.seeded = false;

    this.lastClientSeenAt = Date.now();

    /* Presence is pushed by ChatRoom. Assume someone is
       watching until told otherwise — the safety net below
       corrects it if that assumption is wrong. */
    this.clientsPresent = true;
    this.lastClientCheckAt = 0;
    this.lastInfoCheck = 0;
    this.lastChatPoll = null;
    this.messageCount = 0;
    this.listenersCount = null;
    this.lastError = null;
    this.stoppedReason = null;
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
      this.running = false;
      this.stoppedReason = "manual";
      return this.json({ ok: true, running: false });
    }

    /* Pushed by ChatRoom the moment its last overlay
       disconnects. This replaces asking ChatRoom every 30
       seconds — four rooms doing that kept ChatRoom permanently
       resident and billing, which was the whole problem.

       The grace period still applies from here, so a page
       refresh doesn't tear the upstream connection down. */
    /* ---------------------------------------------------------
       ⭐ LIVE GATE — pushed by the worker's cron.

       An overlay being CONNECTED is not evidence that anyone is
       watching a stream. A monitor tab left open in a browser on a
       laptop that never sleeps is a connection that never ends,
       and under the old rule that alone held this room resident
       24 hours a day, 7 days a week — 84% of the entire monthly
       free allowance, for one room, watching nothing.

       So residency now follows the STREAM, not the socket.

       Defaults to true and is only ever set false by a positive
       "you are offline" answer. If the live check fails, errors or
       never arrives, this room keeps running — losing chat during
       a live stream is a far worse failure than an idle room.
    --------------------------------------------------------- */
    if (url.pathname.endsWith("/live")) {
      let live = true;
      try {
        const body = await request.json();
        live = body?.live !== false;
      } catch { /* unreadable body: assume live, per above */ }

      this.liveGate = live;

      if (live) {
        /* Waking here is what starts the room when the stream
           begins, since the overlay may have been connected for
           hours already and will not reconnect to announce it. */
        this.clientsPresent = true;
        this.lastClientSeenAt = Date.now();
        this.ensureRunning?.();
        await this.scheduleAlarm?.();
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
        handle: this.handle,
        isLive: this.isLive,
        livestreamId: this.livestreamId,
        listenersCount: this.listenersCount,
        messageCount: this.messageCount,
        seenIds: this.seen.size,
        secondsSinceChatPoll: this.lastChatPoll
          ? Math.round((Date.now() - this.lastChatPoll) / 1000)
          : null,
        secondsSinceOverlaySeen:
          Math.round((Date.now() - this.lastClientSeenAt) / 1000),
        stoppedReason: this.stoppedReason,
        lastError: this.lastError
      });
    }

    return new Response("ArenaRoom", { status: 200 });
  }

  /* ---------------------------------------------------------
     ⭐ TRAFFIC BEATS THE GATE.

     The live gate asks one question: is the channel live on
     VELORA. That was right while Velora was the only thing that
     mattered, and wrong the moment a stream goes out to Beam or
     YouTube without Velora — the supervisor then shuts this room
     down every two minutes and chat dies mid-broadcast.

     A message arriving IS proof of a live stream somewhere. So
     recent traffic overrides the gate, and the gate still applies
     the moment the traffic stops.

     Counted only on real broadcast messages, never on keepalives
     or connection frames — the SSE keepalive would otherwise hold
     this open forever and put the 24/7 billing straight back.
  --------------------------------------------------------- */
  hasRecentTraffic() {
    return !!this.lastMessageAt &&
      Date.now() - this.lastMessageAt < TRAFFIC_GRACE_MS;
  }

  async alarm() {
    await this.refreshClientPresence();

    const idleFor = Date.now() - this.lastClientSeenAt;

    if (!this.hasRecentTraffic() &&
        (this.liveGate === false || (!this.clientsPresent && idleFor > IDLE_SHUTDOWN_MS))) {
      if (this.running) {
        console.log("[ARENA] no overlays connected — stopping poller");
      }

      this.running = false;
      this.stoppedReason = "idle";
      return;   // no alarm rescheduled: object can be evicted
    }

    this.ensureRunning();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    try {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    } catch (err) {
      console.error("[ARENA] setAlarm failed:", err);
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
      return null;   // unknown — stay up rather than cut the feed
    }
  }

  ensureRunning() {
    if (this.running) return;
    if (!this.handle) {
      console.warn("[ARENA] ARENA_HANDLE not configured");
      return;
    }

    this.running = true;
    this.lastError = null;

    this.pollLoop();
    this.scheduleAlarm();
  }

  async pollLoop() {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.lastError = String(err?.message || err);
        console.error("[ARENA] poll error:", this.lastError);
      }

      await new Promise((r) =>
        setTimeout(r, this.isLive ? CHAT_POLL_MS : INFO_POLL_MS)
      );
    }
  }

  async tick() {
    // Refresh live status periodically, and always while offline.
    const infoStale = Date.now() - this.lastInfoCheck > INFO_POLL_MS;
    if (!this.isLive || infoStale) await this.checkLive();

    if (!this.isLive || !this.livestreamId) return;

    await this.pollChat();
  }

  async checkLive() {
    this.lastInfoCheck = Date.now();

    const res = await fetch(
      `${ARENA_API}/livestreams/public/info?handle=${encodeURIComponent(this.handle)}`,
      { headers: { "Accept": "application/json" } }
    );

    // Offline returns a non-200 / empty body rather than a flag.
    if (!res.ok) {
      this.setOffline();
      return;
    }

    let json;
    try {
      json = await res.json();
    } catch {
      this.setOffline();
      return;
    }

    const stream = json?.livestream;

    if (!stream?.id || stream.isActive === false) {
      this.setOffline();
      return;
    }

    this.listenersCount = Number(json?.listenersCount ?? 0);

    if (stream.id !== this.livestreamId) {
      // New stream — reset dedupe so the next poll seeds afresh.
      console.log("[ARENA] live:", stream.id, `(${stream.name || "untitled"})`);
      this.livestreamId = stream.id;
      this.seen.clear();
      this.seeded = false;
    }

    this.isLive = true;
  }

  setOffline() {
    if (this.isLive) console.log("[ARENA] channel went offline");
    this.isLive = false;
    this.livestreamId = null;
    this.seeded = false;
    this.seen.clear();
  }

  async pollChat() {
    const res = await fetch(
      `${ARENA_API}/live-chat/public/history/livestream/${this.livestreamId}`,
      { headers: { "Accept": "application/json" } }
    );

    this.lastChatPoll = Date.now();

    if (!res.ok) throw new Error(`chat history returned ${res.status}`);

    const json = await res.json();
    const entries = transformArenaHistory(json);

    /* First poll of a stream: record the ids without rendering.
       Otherwise connecting an overlay mid-stream would replay the
       whole backlog into the lane at once. */
    if (!this.seeded) {
      for (const { id } of entries) this.remember(id);
      this.seeded = true;
      console.log(`[ARENA] seeded ${entries.length} existing messages`);
      return;
    }

    for (const { id, payload } of entries) {
      if (this.seen.has(id)) continue;

      this.remember(id);
      this.messageCount++;
      this.lastMessageAt = Date.now();
      await this.broadcast(payload);
    }
  }

  remember(id) {
    this.seen.add(id);

    if (this.seen.size > MAX_SEEN_IDS) {
      // Sets iterate in insertion order, so this drops the oldest.
      const excess = this.seen.size - MAX_SEEN_IDS;
      let i = 0;
      for (const old of this.seen) {
        if (i++ >= excess) break;
        this.seen.delete(old);
      }
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
      console.error("[ARENA] broadcast failed:", err);
    }
  }

  json(body) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}
