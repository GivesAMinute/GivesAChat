// givesachat-cloudflare/src/facebookRoom.js

import { transformFacebookComment } from "./facebookTransform.js";
import { getFacebookToken, pageTokens, FB_API } from "./facebookAuth.js";

/* ---------------------------------------------------------
   FacebookRoom

   Reads live comments from Facebook PAGES. Not from a personal
   profile — that is not possible, see facebookAuth.js.

   Comments are POLLED from the comments edge, not streamed.
   Facebook documents an SSE endpoint for this and it does not
   work for us; the reasoning is below, next to the poll
   interval, because that is where it matters.

   TWO IDS, AND THEY ARE NOT THE SAME.

   The live video id (1720426506756681) is what the comments edge
   is keyed to. The permalink carries a DIFFERENT id
   (1035671325924215), and comment ids are prefixed with that
   second one. Using the permalink id gets you nothing.

   THE LIVE VIDEO ID CHANGES EVERY BROADCAST, so it is resolved
   at runtime from the Page — the same lesson as Odysee's claim
   id, arriving from a different direction.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   Why this polls instead of streaming

   Facebook documents an SSE endpoint for exactly this:

     streaming-graph.facebook.com/{live-video-id}/live_comments

   It does not work for us. Every request returns 400 with a
   generic HTML error page — and critically, SO DOES A REQUEST
   FOR VIDEO ID "1". A nonexistent broadcast answering
   identically to a real one means the endpoint never evaluates
   the request at all, so no combination of fields, headers or
   ids was ever going to fix it. Six field variants and six
   header/id variants, all identical.

   That control is the only reason we stopped looking. Without
   it, a wall of 400s looks like a parameter problem forever.

   The comments EDGE works fine — it returned real comments
   during setup — so we poll it. Slower and it costs rate limit,
   but it works today, which beats an elegant integration that
   doesn't.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   Poll interval, and why it adapts

   The app rate limit is small and its exact shape is unclear:
   calls made with a Page token may count against the Page's
   budget rather than the app's. Rather than guess, we start at
   a sensible rate and let Facebook's own x-app-usage header
   tell us when to back off.
--------------------------------------------------------- */
const COMMENT_POLL_MS = 15_000;
const COMMENT_POLL_MAX_MS = 60_000;

/* Percentages from x-app-usage. Back off well before the cliff:
   being throttled mid-stream loses chat entirely, whereas
   polling slower just adds latency. */
const USAGE_BACKOFF_AT = 75;
const USAGE_RECOVER_AT = 40;

/* Comment ids already sent, so a poll that overlaps the previous
   window doesn't render everything twice. Bounded — a long
   stream would otherwise grow this without limit. */
const SEEN_LIMIT = 500;

const ALARM_INTERVAL_MS = 30_000;
const IDLE_SHUTDOWN_MS = 120_000;
const TRAFFIC_GRACE_MS = 300_000;  // 5 min of real messages holds the room open

/* Safety net only — presence is pushed by ChatRoom. */
const CLIENT_RECHECK_MS = 300_000;

/* ---------------------------------------------------------
   How often to ask "are you live yet?"

   THE APP RATE LIMIT IS THE BINDING CONSTRAINT, and it is far
   smaller than it looks. A Development-mode app gets

     200 calls per hour  ×  number of app users

   and there is exactly one app user. So the entire budget is
   200 calls an hour, for everything.

   At 30 seconds this poll alone was 120 calls/hour — sixty
   percent of the quota spent on a question that is almost
   always answered "no". At 120 seconds it is 30 calls/hour,
   which is 15%, and costs at most two minutes before chat
   appears if you were already live when the overlay opened.

   In practice it costs nothing at all: ensureRunning() checks
   immediately, and the overlay is normally opened before going
   live.

   The proper fix is the live_videos webhook — Facebook tells us
   instead of being asked — which needs pages_manage_metadata.
   Same "push, don't poll" lesson the Durable Object work taught
   us, arriving from the other side of the wire.
--------------------------------------------------------- */
const LIVE_RECHECK_MS = 120_000;

const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export class FacebookRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.running = false;
    this.backoff = MIN_BACKOFF_MS;

    /* pageId -> { name, liveVideoId, abort, connectedAt } */
    this.streams = new Map();

    this.lastLiveCheckAt = 0;
    this.messageCount = 0;
    this.lastError = null;
    this.stoppedReason = null;
    this.lastClientSeenAt = Date.now();

    this.clientsPresent = true;
    this.lastClientCheckAt = 0;

    this.recentFrames = [];

    /* Adaptive: raised by readUsage() when Facebook says we are
       pushing too hard, restored when the window clears. */
    this.pollInterval = COMMENT_POLL_MS;
    this.usage = null;
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
        streams: [...this.streams.entries()].map(([id, s]) => ({
          pageId: id,
          pageName: s.name,
          liveVideoId: s.liveVideoId,
          connectedAt: s.connectedAt
        })),
        messageCount: this.messageCount,
        pollIntervalMs: this.pollInterval,
        appUsagePercent: this.usage,
        stoppedReason: this.stoppedReason,
        lastError: this.lastError,
        recentFrames: this.recentFrames
      });
    }

    return new Response("FacebookRoom", { status: 200 });
  }

  /* ---------------------------------------------------------
     Which Pages are live right now?

     Asked per Page, with that Page's own non-expiring token.
     A Page that stops being live has its stream closed; one that
     starts gets a stream opened. Doing both here means going
     live mid-session picks up without anyone touching anything.
  --------------------------------------------------------- */
  async refreshLiveStreams() {
    const now = Date.now();
    if (now - this.lastLiveCheckAt < LIVE_RECHECK_MS) return;
    this.lastLiveCheckAt = now;

    const token = await getFacebookToken(this.env);
    const pages = pageTokens(token);

    if (!pages.length) {
      this.lastError = "no Page tokens stored — connect at /facebook/connect";
      console.error("[FACEBOOK]", this.lastError);
      return;
    }

    console.log(`[FACEBOOK] checking ${pages.length} page(s) for a broadcast`);

    for (const page of pages) {
      try {
        const res = await fetch(
          `${FB_API}/${page.id}/live_videos?fields=id,status&limit=5` +
            `&access_token=${encodeURIComponent(page.access_token)}`,
          { signal: AbortSignal.timeout(8000) }
        );

        const json = await res.json();

        if (!res.ok) {
          /* A Page token that has been invalidated — password
             change, permission revoked, Page ownership moved.
             Named loudly: these tokens are meant to be permanent,
             so one failing is a real event, not noise. */
          this.lastError =
            `${page.name}: ${json?.error?.message || res.status}`;
          console.error("[FACEBOOK]", this.lastError);
          continue;
        }

        /* We only reach here for Pages with NO open stream, so
           there is nothing to compare against or tear down —
           either a broadcast is running and we attach to it, or
           there isn't one and we wait. */
        const statuses = (json.data || [])
          .map((v) => `${v.id}:${v.status}`)
          .join(" ");

        console.log(
          `[FACEBOOK] ${page.name} -> ${statuses || "no videos returned"}`
        );

        /* ---------------------------------------------------
           This check is what tells us a broadcast ENDED.

           With SSE, the connection closing would have said so.
           The comments edge never stops answering — it serves
           the finished VOD's comments quite happily — so the
           only signal is status no longer being LIVE.
        --------------------------------------------------- */
        const live = (json.data || []).find((v) => v.status === "LIVE");
        const current = this.streams.get(page.id);

        if (!live) {
          if (current) {
            console.log(`[FACEBOOK] ${page.name} stopped broadcasting`);
            this.closeStream(page.id);
          }
          continue;
        }

        // Same broadcast we are already polling — nothing to do.
        if (current && current.liveVideoId === live.id) continue;

        /* A different id means the broadcast was restarted. Close
           the old poller first or we would hold two. */
        if (current) this.closeStream(page.id);

        console.log(
          `[FACEBOOK] ${page.name} is live (${live.id}) — polling comments`
        );
        this.openStream(page, live.id);
      } catch (err) {
        this.lastError = `${page.name}: ${String(err?.message || err)}`;
        console.error("[FACEBOOK] live check failed:", this.lastError);
      }
    }
  }

  /* ---------------------------------------------------------
     The SSE stream

     Not awaited: it runs until the broadcast ends or we close
     it. Errors are handled inside so an unhandled rejection
     can't take the room down.
  --------------------------------------------------------- */
  openStream(page, liveVideoId) {
    const abort = new AbortController();

    this.streams.set(page.id, {
      name: page.name,
      liveVideoId,
      abort,
      connectedAt: Date.now()
    });

    this.readStream(page, liveVideoId, abort).catch((err) => {
      /* Recorded as well as logged. A stream that fails to open
         at all — a 400 on the fields param, a rejected token —
         otherwise leaves the room looking idle and blameless,
         which is precisely the state that is hardest to debug. */
      this.lastError = `stream ${liveVideoId}: ${err?.message || err}`;
      console.error("[FACEBOOK] stream ended with error:", this.lastError);
      this.streams.delete(page.id);
    });
  }

  closeStream(pageId) {
    const s = this.streams.get(pageId);
    if (!s) return;

    try { s.abort.abort(); } catch {}
    this.streams.delete(pageId);
  }

  /* ---------------------------------------------------------
     Poll one broadcast's comments until it ends.

     Runs as a loop rather than off the alarm so the DO stays
     resident for the duration — the same residency an SSE
     connection would have cost, and it keeps the polling
     cadence independent of the 30-second alarm.
  --------------------------------------------------------- */
  async readStream(page, liveVideoId, abort) {
    console.log(
      `[FACEBOOK] polling comments for ${page.name} (${liveVideoId})`
    );

    const seen = new Set();
    let firstPass = true;

    while (!abort.signal.aborted) {
      const url =
        `${FB_API}/${liveVideoId}/comments` +
        `?access_token=${encodeURIComponent(page.access_token)}` +
        `&fields=${encodeURIComponent("id,message,created_time,from{id,name,picture}")}` +
        `&order=reverse_chronological&limit=25`;

      let res;
      try {
        res = await fetch(url, { signal: abort.signal });
      } catch (err) {
        if (abort.signal.aborted) break;
        throw err;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`comments -> ${res.status} ${body.slice(0, 200)}`);
      }

      this.readUsage(res);

      const json = await res.json();
      const rows = json?.data || [];

      /* ---------------------------------------------------
         The first pass is BACKFILL, not new chat.

         Whatever is already on the broadcast when we attach
         gets marked as seen and not rendered. Without this,
         opening the overlay mid-stream would dump the last
         25 comments into the lane at once — which is what
         every other platform here deliberately avoids.
      --------------------------------------------------- */
      for (const row of rows) {
        if (!row?.id) continue;

        if (seen.has(row.id)) continue;
        seen.add(row.id);

        if (firstPass) continue;

        this.handleComment(row, page);
      }

      /* Bound the set. reverse_chronological means the oldest
         entries are the ones safe to forget. */
      if (seen.size > SEEN_LIMIT) {
        const excess = seen.size - SEEN_LIMIT;
        let i = 0;
        for (const id of seen) {
          if (i++ >= excess) break;
          seen.delete(id);
        }
      }

      if (firstPass) {
        console.log(
          `[FACEBOOK] attached to ${page.name}; ${rows.length} existing ` +
            `comment(s) ignored as backfill`
        );
        firstPass = false;
      }

      await this.sleep(this.pollInterval, abort);
    }

    console.log(`[FACEBOOK] stopped polling ${page.name}`);
    this.streams.delete(page.id);
  }

  sleep(ms, abort) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      abort.signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }

  /* ---------------------------------------------------------
     Let Facebook tell us how hard we are pushing.

     x-app-usage carries call_count as a percentage of the
     window. Backing off on their number beats guessing at a
     budget whose shape we were never sure of.
  --------------------------------------------------------- */
  readUsage(res) {
    try {
      /* ---------------------------------------------------
         TWO different headers, and Page calls use the second.

         x-app-usage covers calls made with a USER token. A call
         made with a PAGE token reports under
         x-business-use-case-usage instead, keyed by page id,
         with the percentages one level deeper.

         Reading only the first left appUsagePercent null on
         every response — an adaptive backoff that could never
         fire, which is worse than no backoff at all because it
         looks like protection.
      --------------------------------------------------- */
      let pct = null;

      const appRaw = res.headers.get("x-app-usage");
      if (appRaw) {
        pct = Number(JSON.parse(appRaw)?.call_count);
      }

      const bucRaw = res.headers.get("x-business-use-case-usage");
      if (bucRaw) {
        const buc = JSON.parse(bucRaw);

        /* { "<page-id>": [ { call_count, total_cputime, ... } ] } */
        for (const entries of Object.values(buc || {})) {
          for (const entry of entries || []) {
            const n = Number(entry?.call_count);
            if (Number.isFinite(n)) pct = Math.max(pct ?? 0, n);
          }
        }
      }

      if (!Number.isFinite(pct)) return;

      this.usage = pct;

      if (pct >= USAGE_BACKOFF_AT && this.pollInterval < COMMENT_POLL_MAX_MS) {
        this.pollInterval = Math.min(this.pollInterval * 2, COMMENT_POLL_MAX_MS);
        console.warn(
          `[FACEBOOK] app usage ${pct}% — slowing polling to ${this.pollInterval}ms`
        );
      } else if (pct <= USAGE_RECOVER_AT && this.pollInterval > COMMENT_POLL_MS) {
        this.pollInterval = COMMENT_POLL_MS;
        console.log(`[FACEBOOK] app usage ${pct}% — polling back to normal`);
      }
    } catch {
      /* Header missing or malformed is not worth failing over. */
    }
  }

  handleComment(comment, page) {
    this.recentFrames.push({
      at: new Date().toISOString().slice(11, 19),
      frame: JSON.stringify(comment).slice(0, 200)
    });
    if (this.recentFrames.length > 20) this.recentFrames.shift();

    const payload = transformFacebookComment(comment, {
      id: page.id,
      name: page.name
    });

    /* A comment arrived and produced nothing renderable —
       attachment-only, most likely. Worth saying out loud: from
       the overlay it is indistinguishable from receiving
       nothing at all. */
    if (!payload) {
      console.log(
        "[FACEBOOK] comment produced no message:",
        JSON.stringify(comment).slice(0, 200)
      );
      return;
    }

    console.log(`[FACEBOOK] comment from ${payload.username}`);

    this.messageCount++;
    this.lastMessageAt = Date.now();
    this.broadcast(payload);
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
      console.error("[FACEBOOK] broadcast failed:", err);
    }
  }

  /* --------------------------------------------------------- */

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
      if (this.running) console.log("[FACEBOOK] no overlays — stopping");
      this.stop("idle");
      return;   // no alarm rescheduled: object can be evicted
    }

    /* A deploy evicts this object, but the alarm is persisted, so
       it can be revived here rather than through ensureRunning().
       Without this the room would reopen streams while still
       reporting running:false — a status line that contradicts
       what the object is actually doing is worse than no status
       line at all. */
    this.running = true;
    this.stoppedReason = null;

    await this.refreshLiveStreams();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    try {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    } catch (err) {
      console.error("[FACEBOOK] setAlarm failed:", err);
    }
  }

  async refreshClientPresence() {
    const now = Date.now();
    if (now - this.lastClientCheckAt < CLIENT_RECHECK_MS) return;
    this.lastClientCheckAt = now;

    const count = await this.overlayCount();
    if (count === null) return;

    this.clientsPresent = count > 0;
    if (count > 0) this.lastClientSeenAt = now;
  }

  async overlayCount() {
    try {
      const id = this.env.ChatRoom.idFromName("givesachat-main-v4");
      const res = await this.env.ChatRoom.get(id).fetch("https://dummy/clients");
      if (!res.ok) return null;

      return Number((await res.json())?.count ?? 0);
    } catch {
      return null;
    }
  }

  stop(reason) {
    this.running = false;
    this.stoppedReason = reason;

    for (const pageId of [...this.streams.keys()]) this.closeStream(pageId);
  }

  ensureRunning() {
    if (this.running) return;

    this.running = true;
    this.lastError = null;

    /* Check immediately rather than waiting for the first alarm —
       opening the overlay when already live should not take 30
       seconds to show chat. */
    this.lastLiveCheckAt = 0;
    this.refreshLiveStreams();
    this.scheduleAlarm();
  }

  json(body) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}
