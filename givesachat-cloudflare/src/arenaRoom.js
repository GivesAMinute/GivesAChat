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
      this.stoppedReason = null;
      this.ensureRunning();
      return this.json({ ok: true, running: this.running });
    }

    if (url.pathname.endsWith("/stop")) {
      this.running = false;
      this.stoppedReason = "manual";
      return this.json({ ok: true, running: false });
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

  async alarm() {
    const count = await this.overlayCount();
    if (count !== null && count > 0) this.lastClientSeenAt = Date.now();

    const idleFor = Date.now() - this.lastClientSeenAt;

    if (count === 0 && idleFor > IDLE_SHUTDOWN_MS) {
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
