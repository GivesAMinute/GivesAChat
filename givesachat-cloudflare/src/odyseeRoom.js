// givesachat-cloudflare/src/odyseeRoom.js

import {
  transformOdyseeFrame,
  safeOdyseeThumbnail,
  findEmoteNames
} from "./odyseeTransform.js";

/* ---------------------------------------------------------
   Resolving a :token: to a picture

   Odysee has three separate asset families behind chat tokens,
   with three unrelated URL shapes, and publishes an index for
   none of them. All three were found by inspecting real
   rendered messages:

     :cowboy_hat_face:
       emoticons/twemoji/smilies/cowboy_hat_face.png
     :rocket:
       emoticons/twemoji/activities/rocket.png
     :confused_2:
       emoticons/48%20px/confused%402x.png
     :PISS:
       stickers/PISS/PNG/piss_with_frame.png

   None of these is derivable from the token:

     - the twemoji CATEGORY is Odysee's own grouping (rocket is
       under activities, though twemoji files it under travel)
     - :confused_2: is NOT confused_2.png. The trailing "_2"
       becomes "@2x", and the directory has a space in it
     - :PISS: is not an emote at all. It is a sticker, in an
       uppercase directory, with a lowercase filename carrying
       a "_with_frame" suffix

   Two samples cannot prove a rule, so nothing here is asserted.
   Every plausible shape is offered as a CANDIDATE and the CDN
   decides which is real. A name resolves to whichever candidate
   returns 200, or to nothing — in which case the token renders
   as text and the log names it.

   Adding a newly discovered shape means adding one line here.
--------------------------------------------------------- */

const CDN = "https://static.odycdn.com";

const TWEMOJI_CATEGORIES = [
  "smilies", "people", "animals", "nature", "food",
  "activities", "travel", "objects", "symbols", "flags"
];

function emoteCandidates(name) {
  const enc = encodeURIComponent;
  const lower = name.toLowerCase();

  const out = [];

  // Standard emoji, filed under Odysee's own category grouping.
  for (const category of TWEMOJI_CATEGORIES) {
    out.push({
      kind: "emote",
      label: `twemoji/${category}`,
      url: `${CDN}/emoticons/twemoji/${category}/${enc(name)}.png`
    });
  }

  /* Odysee's own emote set. ":confused_2:" resolves to
     "confused@2x.png", so the trailing _2 is stripped and the
     retina suffix restored. The plain form is tried too, in
     case the _2 belongs to the name for some other emote. */
  const retina = name.replace(/_2$/, "");

  out.push({
    kind: "emote",
    label: "48px-retina",
    /* "@" is written percent-encoded to match the URL Odysee's
       own client emits byte for byte. Both forms are legal in a
       path and should behave identically, but the encoded one
       is the form actually observed working. */
    url: `${CDN}/emoticons/${enc("48 px")}/${enc(retina)}%402x.png`
  });

  out.push({
    kind: "emote",
    label: "48px",
    url: `${CDN}/emoticons/${enc("48 px")}/${enc(name)}.png`
  });

  /* Stickers. The directory carries the token's own case, the
     file is lowercase. Framed and unframed both exist in their
     client, so both are offered — framed first, since that is
     what chat renders. */
  out.push({
    kind: "sticker",
    label: "sticker-framed",
    url: `${CDN}/stickers/${enc(name)}/PNG/${enc(lower)}_with_frame.png`
  });

  out.push({
    kind: "sticker",
    label: "sticker",
    url: `${CDN}/stickers/${enc(name)}/PNG/${enc(lower)}.png`
  });

  return out;
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
      this.stop("manual");
      return this.json({ ok: true, running: false });
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

  async alarm() {
    const count = await this.overlayCount();
    if (count !== null && count > 0) this.lastClientSeenAt = Date.now();

    if (count === 0 && Date.now() - this.lastClientSeenAt > IDLE_SHUTDOWN_MS) {
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

  async findEmoteAsset(name) {
    const candidates = emoteCandidates(name);

    const attempts = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const res = await fetch(candidate.url, {
            method: "GET",
            signal: AbortSignal.timeout(4000)
          });

          /* The CDN answers 403, not 404, for a file that isn't
             there — so this must test for 200 exactly. Using
             res.ok or !== 404 would treat every miss as a hit
             and point every token at the first candidate. */
          return res.status === 200 ? candidate : null;
        } catch {
          return null;
        }
      })
    );

    /* Candidate ORDER is the tie-break, and it is deliberate:
       twemoji first, then Odysee's own emotes, then stickers
       framed before unframed. */
    return attempts.find(Boolean) || null;
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
