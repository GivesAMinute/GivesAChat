import { VERSION } from "./version.js";

import { ChatRoom } from "./chatRoom.js";
import { PopupRoom } from "./popupRoom.js";
import { BeamRoom } from "./beamRoom.js";
import { ArenaRoom } from "./arenaRoom.js";
import { VPZoneRoom } from "./vpzoneRoom.js";
import { OdyseeRoom } from "./odyseeRoom.js";
import {
  generateAuthorizationUrl,
  exchangeAuthCode,
  getVeloraAccessToken
} from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";
import { probeVeloraEndpoints } from "./veloraEmotes.js";
import {
  VeloraTokenStore,
  putOAuthState,
  takeOAuthState
} from "./veloraTokenStore.js";
import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { debugKickAvatar } from "./kickAvatars.js";
import { subscribeBlazeSession, probeBlazeEndpoints } from "./blazeAuth.js";
import { getBlazeEmoteMap } from "./blazeEmotes.js";

export { ChatRoom, VeloraTokenStore, PopupRoom, BeamRoom, ArenaRoom, VPZoneRoom, OdyseeRoom };

/* ---------------------------------------------------------
   Beam's SSE reader lives in a durable object. Nudge it awake
   whenever an overlay connects, so the stream is running by
   the time the first message arrives. Cheap and idempotent —
   the object ignores the call if it is already reading.
--------------------------------------------------------- */
async function wakeVpzone(env) {
  try {
    const id = env.VPZoneRoom.idFromName("vpzone-live-chat");
    const stub = env.VPZoneRoom.get(id);
    await stub.fetch("https://do/start");
  } catch (err) {
    console.error("VPZONE wake failed:", err);
  }
}

async function wakeOdysee(env) {
  try {
    const id = env.OdyseeRoom.idFromName("odysee-live-chat");
    const stub = env.OdyseeRoom.get(id);
    await stub.fetch("https://do/start");
  } catch (err) {
    console.error("Odysee wake failed:", err);
  }
}

async function wakeArena(env) {
  try {
    const id = env.ArenaRoom.idFromName("arena-live-chat");
    const stub = env.ArenaRoom.get(id);
    await stub.fetch("https://do/start");
  } catch (err) {
    console.error("Arena wake failed:", err);
  }
}

async function wakeBeam(env) {
  try {
    const id = env.BeamRoom.idFromName("beam-unified-chat");
    const stub = env.BeamRoom.get(id);
    const res = await stub.fetch("https://do/start");
    console.log("Beam wake:", res.status);
  } catch (err) {
    console.error("Beam wake failed:", err);
  }
}

/* ---------------------------------------------------------
   Access control

   Two independent keys, both Cloudflare secrets:

     INGEST_KEY   guards POST /api/events/*   (who may put
                  messages ON the overlay)
     OVERLAY_KEY  guards the WebSocket routes (who may read
                  the feed, and who may relay through it)
     VIEWER_KEY   read-only access to /ws/chat, for a public
                  pop-out chat viewers can put on a monitor

   They are separate on purpose: OVERLAY_KEY travels in the
   OBS browser-source URL and can leak on camera, so it must
   not also grant write access to your chat.

   If a key is unset the matching check is skipped and a
   warning is logged, so deploying this cannot take the
   overlay off-air mid-stream. Set both to actually be
   protected:

     npx wrangler secret put INGEST_KEY
     npx wrangler secret put OVERLAY_KEY
     npx wrangler secret put VIEWER_KEY

   VIEWER_KEY is deliberately weaker than OVERLAY_KEY. ChatRoom
   relays 'reward' and 'velora_system' messages between clients
   — that is how the popups overlay pushes cards into chat — so
   anyone holding OVERLAY_KEY can put content on the live
   stream. A viewer key must never carry that ability, so
   sockets opened with it are marked read-only and their
   messages are dropped.
--------------------------------------------------------- */

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function checkKey(request, url, expected) {
  if (!expected) return { ok: true, unconfigured: true };

  const provided =
    request.headers.get("x-gac-key") ||
    url.searchParams.get("key") ||
    "";

  return { ok: timingSafeEqual(provided, expected), unconfigured: false };
}

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    console.log("DEBUG Incoming path:", url.pathname);

    /* ---------------------------------------------------------
       0. Forced Overlay Route Normalization
    --------------------------------------------------------- */
    if (request.method === "GET") {
      if (url.pathname === "/") {
        return Response.redirect(url.origin + "/overlay/chat/", 302);
      }

      if (url.pathname === "/overlay/chat") {
        url.pathname = "/overlay/chat/";
        return Response.redirect(url.toString(), 301);
      }

      if (url.pathname === "/overlay/popups") {
        url.pathname = "/overlay/popups/";
        return Response.redirect(url.toString(), 301);
      }

      if (url.pathname === "/overlay/chat/main.js") {
        url.pathname = "/overlay/chat/";
        return Response.redirect(url.toString(), 301);
      }

      /* -----------------------------------------------------
         ⭐ /chat — public viewer link

         A short, shareable URL for viewers to pop out on a
         second monitor. Redirects to the overlay with the
         read-only VIEWER_KEY already attached, so nothing has
         to be typed or remembered:

           .../chat           -> persistent, header on
           .../chat?header=no -> hide the header

         Read-only by construction: this only ever attaches
         VIEWER_KEY, never OVERLAY_KEY, so the link cannot be
         used to put anything on the live stream.
      ----------------------------------------------------- */
      if (url.pathname === "/chat" || url.pathname === "/chat/") {
        if (!env.VIEWER_KEY) {
          return new Response(
            "Viewer chat is not configured yet.\n\n" +
            "Set it with: npx wrangler secret put VIEWER_KEY",
            { status: 503, headers: { "Content-Type": "text/plain" } }
          );
        }

        const target = new URL("/overlay/chat/", url.origin);
        target.searchParams.set("key", env.VIEWER_KEY);
        target.searchParams.set("mode", "persistent");

        // Header on by default, so viewers get the logo, date and
        // GIVERS Watching Now. ?header=no strips it back to bubbles.
        const header = (url.searchParams.get("header") || "").toLowerCase();
        if (["no", "off", "0", "false", "hide", "none"].includes(header)) {
          target.searchParams.set("header", "no");
        }

        return Response.redirect(target.toString(), 302);
      }
    }

    /* ---------------------------------------------------------
       ⭐ 1. WebSocket for chat overlay (MUST STAY ABOVE ASSETS)
    --------------------------------------------------------- */
    if (url.pathname === "/ws/chat") {
      const auth = checkKey(request, url, env.OVERLAY_KEY);

      /* Full access failed — try the read-only viewer key.
         Sockets opened this way may receive but never relay. */
      let readOnly = false;

      if (!auth.ok) {
        const viewer = checkKey(request, url, env.VIEWER_KEY);
        if (!viewer.ok || viewer.unconfigured) return unauthorized();
        readOnly = true;
      }

      if (auth.unconfigured) console.warn("OVERLAY_KEY unset — /ws/chat is open");

      // Start the Beam reader if it isn't already going.
      // Must go through waitUntil: this response returns
      // immediately, and an un-awaited subrequest would be
      // cancelled before it ever reached the durable object.
      if (ctx?.waitUntil) {
        ctx.waitUntil(wakeBeam(env));
        ctx.waitUntil(wakeArena(env));
        ctx.waitUntil(wakeVpzone(env));
        ctx.waitUntil(wakeOdysee(env));
      } else {
        await wakeBeam(env);
        await wakeArena(env);
        await wakeVpzone(env);
        await wakeOdysee(env);
      }

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      // Tell the durable object how this socket was authorised.
      // Set here, never read from the client.
      const headers = new Headers(request.headers);
      headers.set("x-gac-readonly", readOnly ? "1" : "0");

      return room.fetch(new Request(request, { headers }));
    }

    /* ---------------------------------------------------------
       ⭐ 2. WebSocket for popup overlay (MUST STAY ABOVE ASSETS)
       Viewer key deliberately NOT accepted — popups are yours.
    --------------------------------------------------------- */
    if (url.pathname === "/ws/popups") {
      const auth = checkKey(request, url, env.OVERLAY_KEY);
      if (!auth.ok) return unauthorized();
      if (auth.unconfigured) console.warn("OVERLAY_KEY unset — /ws/popups is open");

      const id = env.PopupRoom.idFromName("givesachat-popups-v3");
      const room = env.PopupRoom.get(id);
      return room.fetch(request);
    }

    /* ---------------------------------------------------------
       3. Beamstream viewer proxy  ("GIVERS Watching Now")
    --------------------------------------------------------- */
    if (url.pathname === "/api/viewers") {
      try {
        const beamUrl =
          "https://beamstream.gg/api/main/api/v1/channel/625942989834817536/viewers";

        const cache = caches.default;
        const cacheKey = new Request(url.toString(), request);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const res = await fetch(beamUrl, {
          method: "GET",
          headers: { "Accept": "application/json" }
        });

        const data = await res.json();

        const response = new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          }
        });

        response.headers.set("Cache-Control", "public, max-age=5");
        await cache.put(cacheKey, response.clone());

        return response;

      } catch (err) {
        return new Response(
          JSON.stringify({
            error: "Beamstream fetch failed",
            details: err.toString()
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }

    /* ---------------------------------------------------------
       ⭐ 4. Static assets (NOW BELOW WS ROUTES)
    --------------------------------------------------------- */
    if (request.method === "GET" && !request.headers.get("Upgrade")) {
      let path = url.pathname;

      if (path.endsWith("/")) {
        path += "index.html";
      }

      const assetUrl = new URL(path, request.url);

      const assetResponse = await env.ASSETS.fetch(
        new Request(assetUrl, request)
      );

      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    }

    /* ---------------------------------------------------------
       5. Velora OAuth login
    --------------------------------------------------------- */
    if (url.pathname === "/velora/login" && request.method === "GET") {
      const state = crypto.randomUUID();
      await putOAuthState(env, state);

      const authUrl = generateAuthorizationUrl(env, state);
      return Response.redirect(authUrl, 302);
    }

    /* ---------------------------------------------------------
       6. Velora OAuth callback
    --------------------------------------------------------- */
    if (url.pathname === "/velora/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      // The state must match the one issued by /velora/login.
      // Without this check anyone could complete the flow with
      // their own Velora account and overwrite the token store.
      const stateOk = await takeOAuthState(env, url.searchParams.get("state"));
      if (!stateOk) {
        return new Response("Invalid or expired OAuth state", { status: 400 });
      }

      const accessToken = await exchangeAuthCode(code, env);
      if (!accessToken) {
        return new Response("Failed to authorize Velora", { status: 500 });
      }

      return new Response("Velora authorized. You can close this window.");
    }

    /* ---------------------------------------------------------
       7. Velora access token endpoint
    --------------------------------------------------------- */
    if (url.pathname === "/api/velora/access-token" && request.method === "GET") {
      const token = await getVeloraAccessToken(env);

      if (!token) {
        return new Response(JSON.stringify({ error: "No token stored" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ access_token: token }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    /* ---------------------------------------------------------
       8. REMOVED: public /velora-token proxy

       This route exposed the stored access_token AND refresh_token
       to anyone on the internet, and /velora-token/set allowed
       overwriting them. Nothing needed it: the worker talks to the
       token store through the env.VeloraTokenStore binding (see
       getVeloraTokens/saveVeloraTokens), and no browser code calls it.
    --------------------------------------------------------- */

    /* ---------------------------------------------------------
       7b. Blaze — subscribe an overlay's Socket.IO session

       Socket.IO does not run in workerd, so the overlay opens
       the connection itself and posts its sessionId here. The
       authenticated subscribe happens on this side, which keeps
       the Blaze client secret out of the browser entirely.

       Guarded by OVERLAY_KEY rather than INGEST_KEY: overlays
       call this, and the overlay key is the one they carry.
    --------------------------------------------------------- */
    if (url.pathname === "/api/blaze/subscribe" && request.method === "POST") {
      /* Accepts the viewer key as well: subscribing a session
         only lets that socket RECEIVE Blaze chat, which is
         exactly what a read-only pop-out needs. */
      const auth = checkKey(request, url, env.OVERLAY_KEY);

      if (!auth.ok) {
        const viewer = checkKey(request, url, env.VIEWER_KEY);
        if (!viewer.ok || viewer.unconfigured) return unauthorized();
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const sessionId = String(body?.sessionId || "").trim();

      if (!sessionId || sessionId.length > 200) {
        return new Response(
          JSON.stringify({ ok: false, error: "sessionId required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      try {
        const results = await subscribeBlazeSession(env, sessionId);
        const ok = Object.values(results).every((r) => r.ok);

        return new Response(JSON.stringify({ ok, results }), {
          status: ok ? 200 : 502,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        console.error("[BLAZE] subscribe error:", err);
        return new Response(
          JSON.stringify({ ok: false, error: String(err?.message || err) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    /* ---------------------------------------------------------
       7b-ii. Blaze emote map

       Blaze chat runs in the overlay (Socket.IO doesn't run in
       workerd), so the overlay needs the id -> imageUrl map to
       render emotes. It cannot fetch it directly — that would
       need the app token in the browser — so the worker holds
       the credential, resolves the map, and hands over just the
       finished URLs.

       Same key treatment as /subscribe: the viewer key is
       accepted, because a read-only pop-out has to render
       emotes too.
    --------------------------------------------------------- */
    if (url.pathname === "/api/blaze/emotes" && request.method === "GET") {
      const auth = checkKey(request, url, env.OVERLAY_KEY);

      if (!auth.ok) {
        const viewer = checkKey(request, url, env.VIEWER_KEY);
        if (!viewer.ok || viewer.unconfigured) return unauthorized();
      }

      try {
        const map = await getBlazeEmoteMap(
          env,
          url.searchParams.get("force") === "1"
        );

        return new Response(
          JSON.stringify({ ok: true, count: Object.keys(map).length, emotes: map }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              /* The overlay refetches on reconnect; a short
                 browser cache keeps that from hammering the
                 worker without making a new emote wait long. */
              "Cache-Control": "public, max-age=300"
            }
          }
        );
      } catch (err) {
        console.error("[BLAZE] emote map error:", err);
        return new Response(
          JSON.stringify({ ok: false, error: String(err?.message || err) }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    /* ---------------------------------------------------------
       7c. Blaze endpoint probe (diagnostic)

       Authenticated discovery for an emotes endpoint Blaze has
       not documented. Delete once emotes are resolved.
    --------------------------------------------------------- */
    if (url.pathname === "/blaze/probe") {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      try {
        const results = await probeBlazeEndpoints(
          env,
          url.searchParams.get("path")
        );

        return new Response(JSON.stringify(results, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: String(err?.message || err) }, null, 2),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    /* ---------------------------------------------------------
       7c-b. Velora endpoint probe (diagnostic)

       Finding the badge catalog and the full emote set — see
       the note in veloraEmotes.js.
    --------------------------------------------------------- */
    if (url.pathname === "/velora/probe") {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const results = await probeVeloraEndpoints(
        env,
        url.searchParams.get("path")
      );

      return new Response(JSON.stringify(results, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    /* ---------------------------------------------------------
       7d-b. VPZONE gateway control (/vpzone/status|start|stop)
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/vpzone/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const action = url.pathname.split("/")[2];
      if (!["start", "stop", "status"].includes(action)) {
        return new Response("Not found", { status: 404 });
      }

      const id = env.VPZoneRoom.idFromName("vpzone-live-chat");
      return env.VPZoneRoom.get(id).fetch(`https://do/${action}`);
    }

    /* ---------------------------------------------------------
       7d-c. Odysee control (/odysee/status|start|stop|resolve)

       `resolve` is a diagnostic — it confirms the shape of the
       LBRY proxy response used for avatars. Remove it once
       avatars are verified on stream.
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/odysee/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const action = url.pathname.split("/")[2];
      if (!["start", "stop", "status", "resolve", "emote"].includes(action)) {
        return new Response("Not found", { status: 404 });
      }

      const id = env.OdyseeRoom.idFromName("odysee-live-chat");
      return env.OdyseeRoom.get(id).fetch(
        `https://do/${action}${url.search}`
      );
    }

    /* ---------------------------------------------------------
       7d. Arena poller control  (/arena/status|start|stop)
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/arena/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const action = url.pathname.split("/")[2];
      if (!["start", "stop", "status"].includes(action)) {
        return new Response("Not found", { status: 404 });
      }

      const id = env.ArenaRoom.idFromName("arena-live-chat");
      const stub = env.ArenaRoom.get(id);
      return stub.fetch(`https://do/${action}`);
    }

    /* ---------------------------------------------------------
       8a. Beam stream control

         /beam/status  what the reader is doing
         /beam/start   force a connect
         /beam/stop    stop until the next overlay connects

       Behind INGEST_KEY — status leaks nothing sensitive, but
       start/stop are controls, so the whole prefix is gated.
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/beam/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const action = url.pathname.split("/")[2];

      // Diagnostic: trace a Kick avatar lookup end to end.
      if (action === "kick-avatar") {
        const slug = url.searchParams.get("slug");
        if (!slug) return new Response("Missing ?slug=", { status: 400 });

        const report = await debugKickAvatar(slug);
        return new Response(JSON.stringify(report, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (!["start", "stop", "status"].includes(action)) {
        return new Response("Not found", { status: 404 });
      }

      const id = env.BeamRoom.idFromName("beam-unified-chat");
      const stub = env.BeamRoom.get(id);

      return stub.fetch(`https://do/${action}`);
    }

    /* ---------------------------------------------------------
       8b. Ingest guard

       Every /api/events/* route below can put content directly
       on the live overlay, so they all sit behind INGEST_KEY.
       Send it as an "x-gac-key" header, or append "?key=..." to
       the URL where a caller cannot set headers (the Velora
       webhook endpoint being the obvious case).
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/api/events/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();
      if (auth.unconfigured) {
        console.warn("INGEST_KEY unset — event endpoints are open to anyone");
      }
    }

    /* ---------------------------------------------------------
       9. Velora → Worker → DO broadcast
    --------------------------------------------------------- */
    if (url.pathname === "/api/events/velora" && request.method === "POST") {
      let veloraEvent;

      try {
        veloraEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      /* -----------------------------------------------------
         Diagnostic for the "1st GIVER" claim events.

         Logs any event the transformer doesn't recognise, plus
         any chat message still containing {placeholders} — the
         claim template arrives unsubstituted, so that pattern
         identifies it without dumping every ordinary message
         into the log.
      ----------------------------------------------------- */
      const knownEvents = [
        "chat.message",
        "channel.channel_points_redemption",
        "pointsCelebration",
        "channel.follow",
        "channel.subscribe",
        "channel.subscription.gift",
        "channel.volts",
        "channel.raid",
        "channel.stream_alert"
      ];

      const rawText = JSON.stringify(veloraEvent?.data ?? {});
      const looksTemplated = /\{(username|times|place|count|amount)\}/i.test(rawText);

      if (!knownEvents.includes(veloraEvent.event) || looksTemplated) {
        console.log(
          "[VELORA UNMAPPED]",
          veloraEvent.event,
          JSON.stringify(veloraEvent).slice(0, 1200)
        );
      }

      const mapped = await transformVeloraEvent(
        veloraEvent.event,
        veloraEvent,
        env
      );

      if (!mapped || mapped.platform === "beam") {
        return new Response("Ignored", { status: 200 });
      }

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mapped)
        })
      );
    }

    /* ---------------------------------------------------------
       10. Beam → Worker → DO broadcast
    --------------------------------------------------------- */
    if (url.pathname === "/api/events/beam" && request.method === "POST") {
      let beamEvent;

      try {
        beamEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      if (beamEvent.platform === "velora") {
        return new Response("Ignored external Velora", { status: 200 });
      }

      const normalized = {
        platform: beamEvent.platform || "beam",
        username: beamEvent.username || "",
        html: sanitizeHtml(beamEvent.html || beamEvent.message || ""),
        avatar: beamEvent.avatar || null,
        badges: beamEvent.badges || [],
        sticker: beamEvent.sticker || null,
        timestamp: beamEvent.timestamp || Date.now()
      };

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalized)
        })
      );
    }

    /* ---------------------------------------------------------
       11. External → Worker → DO broadcast
    --------------------------------------------------------- */
    if (url.pathname === "/api/events/external" && request.method === "POST") {
      let externalEvent;

      try {
        externalEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const normalized = {
        platform: externalEvent.platform || "external",
        username: externalEvent.username || "",
        html: sanitizeHtml(externalEvent.html || externalEvent.message || ""),
        avatar: externalEvent.avatar || null,
        badges: externalEvent.badges || [],
        sticker: externalEvent.sticker || null,
        timestamp: externalEvent.timestamp || Date.now()
      };

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalized)
        })
      );
    }

    /* ---------------------------------------------------------
       12. Blaze → Worker → DO broadcast
    --------------------------------------------------------- */
    function scaleBlazeEmotes(html) {
      return html.replace(
        /([\u{1F300}-\u{1FAFF}])/gu,
        '<span class="blaze-emote">$1</span>'
      );
    }

    if (url.pathname === "/api/events/blaze" && request.method === "POST") {
      let blazeEvent;

      try {
        blazeEvent = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const sender = blazeEvent.sender || {};

      const normalized = {
        type: "chat",
        platform: "blaze",
        data: {
          username: sender.displayName || sender.username || "",
          html: scaleBlazeEmotes(sanitizeHtml(blazeEvent.message || "")),
          avatar: sender.avatarUrl || null,
          badges: sender.roles || [],
          isOwner: sender.isOwner || false,
          sticker: null,
          timestamp: Date.now()
        }
      };

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      return room.fetch(
        new Request("https://dummy/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalized)
        })
      );
    }

    /* ---------------------------------------------------------
       Default fallback
    --------------------------------------------------------- */
    return new Response("Not found", { status: 404 });
  }
};
