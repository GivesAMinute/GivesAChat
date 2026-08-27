// givesachat-cloudflare/src/odyseeRoom.js

import {
  transformOdyseeFrame,
  safeOdyseeThumbnail,
  findEmoteNames
} from "./odyseeTransform.js";

import { odyseeSticker } from "./odyseeStickers.js";
import { odyseeCustomEmote } from "./odyseeEmotes.js";

/* ---------------------------------------------------------
   Resolving a :token: to a picture

   Odysee has three asset families behind chat tokens, with
   three unrelated URL shapes:

     :cowboy_hat_face:  emoticons/twemoji/smilies/cowboy_hat_face.png
     :sleep:            emoticons/48%20px/Sleep%402x.png
     :PISS:             stickers/PISS/PNG/piss_with_frame.png

   Two of the three are ARBITRARY. There is no rule connecting
   ":sleep:" to "Sleep@2x.png" or ":SICK_SKULL:" to "with
   borderdark with frame.png" — those mappings are hand-written
   data, and no amount of pattern-matching reaches them. An
   earlier version of this file tried, and kept half-working.

   Both are now transcribed from Odysee's own client bundle into
   odyseeStickers.js and odyseeEmotes.js, so they resolve
   exactly and cost ZERO requests.

   The twemoji family is the one that genuinely IS derivable —
   the filename is always the token — so only its category needs
   finding, and that is a single parallel batch of seven,
   cached for a week.

   Everything below the manifest check is fallback for tokens
   Odysee has added since these snapshots were taken. It is
   guesswork, and labelled as such.
--------------------------------------------------------- */

const CDN = "https://static.odycdn.com";

/* The COMPLETE set, read from Odysee's emote module — not a
   guess. There are exactly seven, and "people", "animals",
   "travel" and "objects" (which I had invented from twemoji
   convention) are not among them.

   Within a category the filename is the token plus ".png", so
   unlike the custom set these ARE derivable. Only the category
   is unknown, which is one parallel batch of seven and then
   cached for a week. */
const TWEMOJI_CATEGORIES = [
  "smilies", "handsignals", "nature",
  "activities", "symbols", "food", "flags"
];

/* Odysee's list has one token whose filename doesn't match it —
   a typo on their side that would otherwise 404 in all seven
   categories. */
const TWEMOJI_FILENAME = { triump: "triumph" };

const enc = encodeURIComponent;

/* Filenames vary in case independently of the token — ":sleep:"
   is "Sleep@2x.png" — so each candidate name is tried in every
   plausible casing. A Set keeps it to one attempt when several
   forms coincide, which is the common case. */
function caseVariants(word) {
  return [
    ...new Set([
      word,
      word.toLowerCase(),
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
      word.toUpperCase()
    ])
  ];
}

export function emoteCandidates(name) {
  const lower = name.toLowerCase();

  /* ---------------------------------------------------------
     Stickers are a KNOWN LIST, not a guess.

     Odysee's client carries the full sticker manifest as
     hardcoded data, so a match here is exact and costs zero
     requests. Checked first, and returned alone — there is
     nothing to probe.

     A token that is not in the manifest still falls through to
     the candidate list below, so a sticker Odysee adds after
     this snapshot was taken degrades to probing rather than to
     nothing.
  --------------------------------------------------------- */
  const known = odyseeSticker(name) || odyseeCustomEmote(name);
  if (known) return [{ ...known, label: "manifest" }];

  /* ---------------------------------------------------------
     FALLBACK ONLY — everything below is guesswork.

     Both manifests above are snapshots of Odysee's client. A
     token that misses them is either a twemoji emoji (whose
     filename IS derivable: twemoji/<category>/<token>.png, and
     only the category needs finding) or something Odysee added
     after the snapshot was taken.

     ALL-CAPS tokens are stickers, lowercase ones are emotes —
     true across every real sample. Used only to ORDER these,
     never to exclude, so a broken pattern still resolves, just
     one batch later.
  --------------------------------------------------------- */
  const looksLikeSticker = name === name.toUpperCase() && /[A-Z]/.test(name);

  const emotes = [];
  const stickers = [];

  const file = TWEMOJI_FILENAME[name] || name;

  for (const category of TWEMOJI_CATEGORIES) {
    emotes.push({
      kind: "emote",
      label: `twemoji/${category}`,
      url: `${CDN}/emoticons/twemoji/${category}/${enc(file)}.png`
    });
  }

  /* A custom emote added since the snapshot. Case is unknown —
     the manifest shows Sleep, ROCK and ouch all coexisting — so
     the plausible casings are tried. */
  const base = name.replace(/_\d$/, "");

  for (const variant of new Set([...caseVariants(name), ...caseVariants(base)])) {
    emotes.push({
      kind: "emote",
      label: `48px ${variant}@2x`,
      url: `${CDN}/emoticons/${enc("48 px")}/${enc(variant)}%402x.png`
    });
  }

  /* A sticker added since the snapshot. The manifest shows the
     pack is sometimes the token, sometimes its first word, and
     sometimes the shared MISC pack; the frame suffix is spelled
     three ways. These cover the shapes actually seen. */
  const spaced = lower.replace(/_/g, " ");

  for (const pack of new Set([name, name.replace(/_/g, " "), name.split("_")[0], "MISC"])) {
    for (const f of new Set([lower, spaced])) {
      for (const suffix of ["", "_with_frame", "_with-frame"]) {
        stickers.push({
          kind: "sticker",
          label: `sticker ${pack}/${f}${suffix}`,
          url: `${CDN}/stickers/${enc(pack)}/PNG/${enc(f)}${suffix}.png`
        });
      }
    }
  }

  return looksLikeSticker
    ? [...stickers, ...emotes]
    : [...emotes, ...stickers];
}

const EMOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMOTE_FAIL_TTL_MS = 60 * 60 * 1000;
const MAX_EMOTES = 1000;

/* ---------------------------------------------------------
   OdyseeRoom

   Every other platform we carry has a STABLE address for the
   chat room: Beam has a channel, VPZONE has a slug, Arena has a
   handle. Odysee does not. Its socket is keyed to the claim id
   of one specific livestream:

     wss://sockety.odysee.tv/ws/commentron
       ?id=<stream claim id>&category=@Channel:n&sub_category=commenter

   That id is a different 40-character hash for every stream you
   go live with. Hard-coding it would work exactly once and then
   silently deliver nothing, forever, with no error to explain
   why — the socket would still connect, it would just be
   listening to last week's chat.

   So this object resolves the current claim before connecting:

     GET https://api.odysee.live/livestream/is_live
           ?channel_claim_id=<channel claim id>

   which returns Live, ViewerCount and ActiveClaim.ClaimID. The
   CHANNEL claim id is stable and lives in config; the STREAM
   claim id is discovered fresh each time. It is re-checked
   periodically, so ending one stream and starting another
   reconnects the socket on its own without a redeploy.

   That endpoint also hands us the Odysee viewer count for free.
--------------------------------------------------------- */

const GATEWAY = "wss://sockety.odysee.tv/ws/commentron";
const LIVE_API = "https://api.odysee.live/livestream/is_live";
const LBRY_PROXY = "https://api.na-backend.odysee.com/api/v1/proxy";

const ALARM_INTERVAL_MS = 30_000;
const IDLE_SHUTDOWN_MS = 120_000;
const TRAFFIC_GRACE_MS = 300_000;  // 5 min of real messages holds the room open

/* Safety-net interval for the ChatRoom client-count check.
   Presence is normally pushed, so this is a fallback only. */
const CLIENT_RECHECK_MS = 300_000;

/* Commentron is silent when nobody is talking — there is no
   presence or ping frame to use as a liveness signal the way
   VPZONE's presence doubles as one. A quiet socket is normal,
   so it must not be recycled on silence alone. The is_live
   poll is the health check instead. */
const CLAIM_RECHECK_MS = 120_000;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
const AVATAR_FAIL_TTL_MS = 10 * 60 * 1000;
const MAX_AVATARS = 500;

export class OdyseeRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.channelClaimId = env?.ODYSEE_CHANNEL_CLAIM_ID || null;

    this.running = false;
    this.ws = null;
    this.backoff = MIN_BACKOFF_MS;

    // Discovered from the live API, not configured.
    this.claimId = env?.ODYSEE_CLAIM_ID || null;   // optional manual override
    this.category = null;
    this.isLive = false;
    this.lastClaimCheckAt = 0;

    this.avatarCache = new Map();
    this.emoteCache = new Map();     // name -> { category|null, expiresAt }

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
        channelClaimId: this.channelClaimId,
        claimId: this.claimId,
        category: this.category,
        isLive: this.isLive,
        connected: !!this.ws,
        connectedAt: this.connectedAt,
        secondsSinceFrame: this.lastFrameAt
          ? Math.round((Date.now() - this.lastFrameAt) / 1000)
          : null,
        viewerCount: this.viewerCount,
        messageCount: this.messageCount,
        avatarsCached: this.avatarCache.size,
        emotesCached: this.emoteCache.size,
        emoteAssets: Object.fromEntries(
          [...this.emoteCache].map(([name, v]) => [
            name,
            v.asset ? `${v.asset.kind}: ${v.asset.url}` : null
          ])
        ),
        stoppedReason: this.stoppedReason,
        lastError: this.lastError
      });
    }

    /* Diagnostic: resolve one channel url to a thumbnail, so the
       shape of the LBRY proxy response can be confirmed against
       the live API instead of assumed. Delete once avatars are
       verified working. */
    if (url.pathname.endsWith("/resolve")) {
      const target = url.searchParams.get("url");
      if (!target) return this.json({ error: "pass ?url=lbry://@Channel#claimid" });

      const raw = await this.resolveThumbnailRaw(target);
      return this.json(raw);
    }

    /* Diagnostic: which twemoji category does an emote live in?
       See EMOTE_CATEGORIES below. Delete once confirmed. */
    if (url.pathname.endsWith("/emote")) {
      const name = url.searchParams.get("name");
      if (!name || !/^[A-Za-z0-9_+-]{2,40}$/.test(name)) {
        return this.json({ error: "pass ?name=cowboy_hat_face" });
      }
      // Case preserved — CDN paths are case-sensitive.
      return this.json(await this.probeEmote(name));
    }

    return new Response("OdyseeRoom", { status: 200 });
  }

  /* ---------------------------------------------------------
     Emote category probe

     One real emote URL has been observed:

       .../emoticons/twemoji/smilies/cowboy_hat_face.png

     "smilies" is probably a category, which would mean tokens
     from other categories 404 against it. This asks the CDN
     the same question for every candidate at once.

     Read the result like this: if only `smilies` returns 200
     for a smiley AND only `travel` returns 200 for :rocket:,
     the path is per-category and the transform needs a lookup.
     If `smilies` returns 200 for both, Odysee flattened them
     and the current single-path build is already correct.

     The no-category control matters as much as the categories:
     if `_none` returns 200 too, the CDN is serving something
     for any path and none of the 200s mean anything.
  --------------------------------------------------------- */
  async probeEmote(name) {
    const targets = emoteCandidates(name).map((c) => [
      `${c.label} (${c.kind})`,
      c.url
    ]);

    /* A name that cannot exist. If this returns 200 the CDN is
       answering every path with something and none of the other
       200s mean anything. */
    targets.push([
      "_control_should_fail",
      `${CDN}/emoticons/twemoji/smilies/gac_not_a_real_emote.png`
    ]);

    const results = {};

    await Promise.all(
      targets.map(async ([label, target]) => {
        try {
          const res = await fetch(target, {
            method: "GET",
            signal: AbortSignal.timeout(5000)
          });

          results[label] = {
            status: res.status,
            type: res.headers.get("content-type"),
            bytes: res.headers.get("content-length"),
            url: target
          };
        } catch (err) {
          results[label] = { error: String(err?.message || err), url: target };
        }
      })
    );

    return { name, matched: await this.findEmoteAsset(name), results };
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

    if (!this.hasRecentTraffic() &&
        (this.liveGate === false ||
         (!this.clientsPresent && Date.now() - this.lastClientSeenAt > IDLE_SHUTDOWN_MS))) {
      this.stop("idle");
      return;   // no alarm rescheduled — object can be evicted
    }

    /* The stream that was live when we connected may have ended
       and been replaced by a new one with a new claim id. */
    if (Date.now() - this.lastClaimCheckAt > CLAIM_RECHECK_MS) {
      const previous = this.claimId;
      await this.refreshActiveClaim();

      if (this.claimId && previous && this.claimId !== previous) {
        console.log(`[ODYSEE] active claim changed ${previous} -> ${this.claimId} — reconnecting`);
        this.closeSocket();
      }
    }

    this.ensureRunning();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    try {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    } catch (err) {
      console.error("[ODYSEE] setAlarm failed:", err);
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
    if (!this.channelClaimId && !this.claimId) {
      console.warn("[ODYSEE] ODYSEE_CHANNEL_CLAIM_ID not configured");
      return;
    }

    this.running = true;
    this.lastError = null;

    this.connectLoop();
    this.scheduleAlarm();
  }

  /* ---------------------------------------------------------
     Which stream are we listening to?

     ActiveClaim is what Odysee itself points the player and the
     chat at, so it is the right answer whenever it exists —
     including for a scheduled stream that has not started yet,
     which is when pre-show chat happens.
  --------------------------------------------------------- */
  async refreshActiveClaim() {
    this.lastClaimCheckAt = Date.now();

    if (!this.channelClaimId) return;   // running on a manual override

    try {
      const res = await fetch(
        `${LIVE_API}?channel_claim_id=${encodeURIComponent(this.channelClaimId)}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
      );

      if (!res.ok) {
        this.lastError = `is_live -> ${res.status}`;
        return;
      }

      const json = await res.json();
      const data = json?.data || {};

      this.isLive = data.Live === true;
      this.viewerCount = Number(data.ViewerCount ?? 0);

      const claimId = data.ActiveClaim?.ClaimID;
      if (typeof claimId === "string" && claimId.length >= 8) {
        this.claimId = claimId;
      }

      /* The socket wants the channel in "@Name:n" form, but the
         API returns it as "lbry://@Name#n/title". Deriving it
         here means the channel handle never has to be kept in
         config alongside the claim id, where the two could
         drift apart. */
      const canonical = data.ActiveClaim?.CanonicalURL;
      const match = /^lbry:\/\/(@[^#/]+)#([^/]+)/.exec(String(canonical || ""));
      if (match) this.category = `${match[1]}:${match[2]}`;
    } catch (err) {
      this.lastError = String(err?.message || err);
      console.warn("[ODYSEE] is_live lookup failed:", this.lastError);
    }
  }

  async connectLoop() {
    while (this.running) {
      try {
        if (!this.claimId || Date.now() - this.lastClaimCheckAt > CLAIM_RECHECK_MS) {
          await this.refreshActiveClaim();
        }

        if (!this.claimId) {
          /* Nothing live and nothing scheduled. Not an error —
             this is the normal state between streams. Wait and
             look again rather than spinning. */
          this.stoppedReason = "no active claim";
          await new Promise((r) => setTimeout(r, 30_000));
          continue;
        }

        this.stoppedReason = null;
        await this.connect();
        this.backoff = MIN_BACKOFF_MS;
      } catch (err) {
        this.lastError = String(err?.message || err);
        console.error("[ODYSEE] connect error:", this.lastError);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }

      if (!this.running) break;
      await new Promise((r) => setTimeout(r, this.backoff));
    }
  }

  /**
   * Opens the sockety socket and resolves when it closes.
   */
  async connect() {
    const params = new URLSearchParams({
      id: this.claimId,
      sub_category: "commenter"
    });

    // Observed on the live pop-out; sockety routes on it.
    if (this.category) params.set("category", this.category);

    /* Cloudflare performs the upgrade over http(s) and hands
       back res.webSocket — passing wss:// fails outright with
       "Fetch API cannot load". */
    const fetchUrl =
      `${GATEWAY}?${params}`.replace(/^wss:\/\//i, "https://");

    const res = await fetch(fetchUrl, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;

    if (!ws) throw new Error(`gateway did not upgrade (status ${res.status})`);

    ws.accept();

    this.ws = ws;
    this.connectedAt = Date.now();
    this.lastFrameAt = Date.now();
    console.log(`[ODYSEE] connected to claim ${this.claimId} (${this.category || "no category"})`);

    return new Promise((resolve) => {
      ws.addEventListener("message", (event) => {
        this.lastFrameAt = Date.now();
        this.handleFrame(event.data);
      });

      ws.addEventListener("close", (event) => {
        console.log(`[ODYSEE] socket closed: ${event.code} ${event.reason || ""}`);
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

    /* Emote categories have to be known BEFORE the html is
       built, so they are resolved from the raw comment text
       first and handed to the transform. */
    const assets = await this.emoteAssets(
      findEmoteNames(frame?.data?.comment?.comment)
    );

    const payload = transformOdyseeFrame(frame, assets);
    if (!payload) return;

    /* Guard against a history replay on connect. Commentron
       stores every comment permanently — if sockety ever
       replays on subscribe, an overlay connecting mid-stream
       would repaint the entire backlog into the lane. A 30s
       grace absorbs ordinary clock skew between us and them. */
    if (this.connectedAt && payload.timestamp < this.connectedAt - 30_000) {
      return;
    }

    payload.avatar = await this.avatarFor(payload.channelId, payload.channelUrl);

    // Internal routing fields — not needed by the overlay.
    delete payload.channelId;
    delete payload.channelUrl;

    this.messageCount++;
    this.lastMessageAt = Date.now();
    await this.broadcast(payload);
  }

  /* ---------------------------------------------------------
     Resolving tokens to assets

     Every candidate path is asked at once and the first 200
     wins, so an unknown token costs one round trip rather than
     fourteen. Each answer is cached for a week: a given emote
     is looked up once, ever, and chat reuses the same handful
     constantly so the cache is warm within a minute of going
     live.

     Misses are cached too, for an hour. Without that, someone
     spamming a typo'd :token: would re-probe every candidate on
     every single message they send.
  --------------------------------------------------------- */
  async emoteAssets(names) {
    if (!names.length) return null;

    const now = Date.now();
    const out = new Map();
    const unknown = [];

    for (const name of names) {
      const hit = this.emoteCache.get(name);
      if (hit && now < hit.expiresAt) out.set(name, hit.asset);
      else unknown.push(name);
    }

    await Promise.all(
      unknown.map(async (name) => {
        const asset = await this.findEmoteAsset(name);

        if (this.emoteCache.size >= MAX_EMOTES) {
          this.emoteCache.delete(this.emoteCache.keys().next().value);
        }

        this.emoteCache.set(name, {
          asset,
          expiresAt: now + (asset ? EMOTE_TTL_MS : EMOTE_FAIL_TTL_MS)
        });

        out.set(name, asset);

        console.log(
          `[ODYSEE] :${name}: -> ${asset ? `${asset.kind} (${asset.label})` : "no candidate matched"}`
        );
      })
    );

    return out;
  }

  /* ---------------------------------------------------------
     Candidates are tried in BATCHES, not all at once.

     The list has grown past forty as more sticker shapes turned
     up, and firing all of them would spend forty subrequests on
     every unknown token — against a per-invocation cap, inside
     a websocket handler that is holding up a chat message.

     Ordering already puts the likely shapes first, so batching
     means the common case costs one batch and the pathological
     case is still bounded. A batch that hits returns without
     issuing the rest at all.
  --------------------------------------------------------- */
  async findEmoteAsset(name) {
    const candidates = emoteCandidates(name);

    /* A manifest hit is authoritative — Odysee's own client
       uses this exact URL. Nothing to verify, nothing to
       fetch. */
    if (candidates.length === 1 && candidates[0].label === "manifest") {
      return candidates[0];
    }

    const BATCH = 12;

    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);

      const attempts = await Promise.all(
        batch.map(async (candidate) => {
          try {
            const res = await fetch(candidate.url, {
              method: "GET",
              signal: AbortSignal.timeout(4000)
            });

            /* The CDN answers 403, not 404, for a file that
               isn't there — so this must test for 200 exactly.
               res.ok or !== 404 would treat every miss as a hit
               and point every token at the first candidate. */
            return res.status === 200 ? candidate : null;
          } catch {
            return null;
          }
        })
      );

      const hit = attempts.find(Boolean);
      if (hit) return hit;
    }

    return null;
  }

  /* ---------------------------------------------------------
     Avatars

     Comment frames carry no picture, so each channel's
     thumbnail is resolved once and cached. Unlike VPZONE this
     needs no API key — resolve is public — so avatars work
     without any credential at all.

     Failures are cached too, for a shorter time. A channel with
     no thumbnail set would otherwise trigger a lookup on every
     single message it posts.
  --------------------------------------------------------- */
  async avatarFor(channelId, channelUrl) {
    if (!channelId || !channelUrl) return null;

    const now = Date.now();
    const hit = this.avatarCache.get(channelId);
    if (hit && now < hit.expiresAt) return hit.url;

    if (this.avatarCache.size >= MAX_AVATARS) {
      this.avatarCache.delete(this.avatarCache.keys().next().value);
    }

    let url = null;

    try {
      const raw = await this.resolveThumbnailRaw(channelUrl);
      url = safeOdyseeThumbnail(raw?.thumbnail);
    } catch (err) {
      console.warn("[ODYSEE] avatar lookup failed:", String(err?.message || err));
    }

    this.avatarCache.set(channelId, {
      url,
      expiresAt: now + (url ? AVATAR_TTL_MS : AVATAR_FAIL_TTL_MS)
    });

    return url;
  }

  /**
   * Calls the LBRY proxy's resolve method for one channel url.
   * Returns { thumbnail, title } — or an { error } object, which
   * is what the /resolve diagnostic surfaces.
   */
  async resolveThumbnailRaw(channelUrl) {
    const res = await fetch(LBRY_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "resolve",
        params: { urls: [channelUrl] }
      }),
      signal: AbortSignal.timeout(4000)
    });

    if (!res.ok) return { error: `resolve -> ${res.status}` };

    const json = await res.json();
    const entry = json?.result?.[channelUrl];

    if (!entry || entry.error) {
      return { error: entry?.error?.name || "not found", raw: json?.result ? Object.keys(json.result) : null };
    }

    return {
      thumbnail: entry?.value?.thumbnail?.url || null,
      title: entry?.value?.title || null
    };
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
      console.error("[ODYSEE] broadcast failed:", err);
    }
  }

  json(body) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}
