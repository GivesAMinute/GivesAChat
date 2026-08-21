// givesachat-cloudflare/src/facebookRoom.js

import { transformFacebookComment } from "./facebookTransform.js";
import { getFacebookToken, pageTokens, FB_API } from "./facebookAuth.js";

/* ---------------------------------------------------------
   FacebookRoom

   Facebook is the only platform here with a real, documented
   streaming endpoint:

     https://streaming-graph.facebook.com/{live-video-id}/live_comments
       ?access_token=…&comment_rate=one_per_two_seconds&fields=…

   Server-sent events, same shape as Beam's feed, so this is the
   most conventional integration in the project — after being by
   far the most awkward to get permission for.

   TWO IDS, AND THEY ARE NOT THE SAME.

   The live video id (1720419190090746) is what the SSE stream
   and the comments edge are keyed to. The permalink carries a
   DIFFERENT id (1090562013396681), and comment ids are prefixed
   with that second one. Using the permalink id to open the
   stream returns nothing, forever, without an error.

   THE LIVE VIDEO ID CHANGES EVERY BROADCAST, so it is resolved
   at runtime from the Page — the same lesson as Odysee's claim
   id, arriving from a different direction.
--------------------------------------------------------- */

const STREAM_HOST = "https://streaming-graph.facebook.com";

/* one_per_two_seconds is Facebook's rate cap on the stream.
   The alternative, ten_per_second, is for high-volume broadcasts
   and would deliver bursts the lane cannot render anyway. */
const COMMENT_RATE = "one_per_two_seconds";

const ALARM_INTERVAL_MS = 30_000;
const IDLE_SHUTDOWN_MS = 120_000;

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
      return;
    }

    for (const page of pages) {
      /* ---------------------------------------------------
         A Page we are already streaming needs no polling at
         all. The SSE connection ending IS the notification
         that the broadcast stopped — readStream() removes it
         from the map, and the next check reopens or moves on.

         This is the bigger saving of the two: during an
         actual stream, when the overlay is open for hours,
         this loop now makes zero calls instead of 120 an
         hour against a 200/hour budget.
      --------------------------------------------------- */
      if (this.streams.has(page.id)) continue;

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
        const live = (json.data || []).find((v) => v.status === "LIVE");
        if (!live) continue;

        console.log(
          `[FACEBOOK] ${page.name} is live (${live.id}) — opening comments`
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
      console.error("[FACEBOOK] stream ended with error:", err?.message || err);
      this.streams.delete(page.id);
    });
  }

  closeStream(pageId) {
    const s = this.streams.get(pageId);
    if (!s) return;

    try { s.abort.abort(); } catch {}
    this.streams.delete(pageId);
  }

  async readStream(page, liveVideoId, abort) {
    const url =
      `${STREAM_HOST}/${liveVideoId}/live_comments` +
      `?access_token=${encodeURIComponent(page.access_token)}` +
      `&comment_rate=${COMMENT_RATE}` +
      `&fields=${encodeURIComponent("id,message,created_time,from{id,name,picture}")}`;

    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: abort.signal
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `live_comments -> ${res.status} ${body.slice(0, 200)}`
      );
    }

    this.backoff = MIN_BACKOFF_MS;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      /* SSE events are separated by a blank line. Anything after
         the last separator is a partial event and stays in the
         buffer — splitting on newline instead would hand half a
         JSON object to the parser under load, which is the
         classic way this goes wrong. */
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        this.handleEvent(event, page);
      }
    }

    console.log(`[FACEBOOK] comment stream closed for ${page.name}`);
    this.streams.delete(page.id);
  }

  handleEvent(raw, page) {
    /* An SSE event can carry several data: lines, which are
       concatenated. Comment payloads are single-line in practice,
       but assuming so would break silently on a long message. */
    const data = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");

    if (!data) return;

    this.recentFrames.push({
      at: new Date().toISOString().slice(11, 19),
      frame: data.slice(0, 200)
    });
    if (this.recentFrames.length > 20) this.recentFrames.shift();

    let comment;
    try {
      comment = JSON.parse(data);
    } catch {
      console.warn("[FACEBOOK] unparseable event:", data.slice(0, 120));
      return;
    }

    const payload = transformFacebookComment(comment, {
      id: page.id,
      name: page.name
    });

    if (!payload) return;

    this.messageCount++;
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

  async alarm() {
    await this.refreshClientPresence();

    const idleFor = Date.now() - this.lastClientSeenAt;

    if (!this.clientsPresent && idleFor > IDLE_SHUTDOWN_MS) {
      if (this.running) console.log("[FACEBOOK] no overlays — stopping");
      this.stop("idle");
      return;   // no alarm rescheduled: object can be evicted
    }

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
