import { VERSION } from "./version.js";

import { ChatRoom } from "./chatRoom.js";
import { PopupRoom } from "./popupRoom.js";
import { BeamRoom } from "./beamRoom.js";
import { ArenaRoom } from "./arenaRoom.js";
import { VPZoneRoom } from "./vpzoneRoom.js";
import { OdyseeRoom } from "./odyseeRoom.js";
import { BitChuteRoom } from "./bitchuteRoom.js";
import { FacebookRoom } from "./facebookRoom.js";
import {
  FacebookTokenStore,
  beginFacebookAuth,
  completeFacebookAuth,
  getFacebookToken,
  describeToken,
  pageTokens,
  allowedPageIds,
  FB_API
} from "./facebookAuth.js";
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

export {
  ChatRoom,
  VeloraTokenStore,
  PopupRoom,
  BeamRoom,
  ArenaRoom,
  VPZoneRoom,
  OdyseeRoom,
  BitChuteRoom,
  FacebookTokenStore,
  FacebookRoom
};

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

async function wakeBitchute(env) {
  try {
    const id = env.BitChuteRoom.idFromName("bitchute-live-chat");
    const stub = env.BitChuteRoom.get(id);
    await stub.fetch("https://do/start");
  } catch (err) {
    console.error("BitChute wake failed:", err);
  }
}

async function wakeFacebook(env) {
  try {
    const id = env.FacebookRoom.idFromName("facebook-live-chat");
    const stub = env.FacebookRoom.get(id);
    await stub.fetch("https://do/start");
  } catch (err) {
    console.error("Facebook wake failed:", err);
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

/* ---------------------------------------------------------
   Strip access tokens out of anything we hand back.

   Graph API embeds the caller's token in its own paging URLs:

     "next": "https://graph.facebook.com/...?access_token=EAAY..."

   So a diagnostic that dumps a raw Graph response leaks a live
   credential to whoever reads the output — which is exactly what
   happened the first time /facebook/probe was run, into a chat
   window. Redaction lives here rather than at the call site so
   there is one place to get it right.

   Recursive, because the token can be nested arbitrarily deep.
--------------------------------------------------------- */
function redactTokens(value) {
  if (typeof value === "string") {
    return value.replace(
      /(access_token=)[A-Za-z0-9._\-]+/gi,
      "$1[REDACTED]"
    );
  }

  if (Array.isArray(value)) return value.map(redactTokens);

  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      /* Never echo a token — but match the key exactly rather
         than loosely. A bare `token` key was also catching our
         own describeToken() status block, redacting the expiry
         and connection state that the diagnostic exists to
         report. Over-redaction is a smaller failure than a leak,
         but it still hides the answer. */
      if (/^(access_token|fb_exchange_token|client_secret|app_secret)$/i.test(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = redactTokens(v);
    }
    return out;
  }

  return value;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/* ---------------------------------------------------------
   A human lands on the Facebook callback in a browser, usually
   straight after pressing a Stream Deck button, so it answers in
   plain language rather than JSON.

   Text is escaped and inserted as textContent would be — the
   message can carry a Facebook error string, which is not ours
   and not to be trusted as markup.
--------------------------------------------------------- */
function facebookPage(title, message, ok) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const accent = ok ? "#4ade80" : "#f87171";

  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GivesAChat — Facebook</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;
justify-content:center;background:#121212;color:#e8e8e8;
font-family:Inter,system-ui,-apple-system,sans-serif;padding:24px">
<div style="max-width:520px">
<h1 style="font-size:26px;font-weight:600;margin:0 0 12px;color:${accent}">
${esc(title)}</h1>
<pre style="white-space:pre-wrap;font-size:16px;line-height:1.6;
font-family:inherit;margin:0;color:#c8c8c8">${esc(message)}</pre>
<p style="margin-top:28px;font-size:15px;color:#8a8a8a">
You can close this tab.</p>
</div></body></html>`,
    {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }
  );
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

      /* ---------------------------------------------------------
         The popups overlay opens a chat socket too, but only to
         PUSH reward and velora_system cards into the lane. It
         never reads Beam, Arena, VPZONE or Odysee messages.

         Treating it like a chat overlay meant opening the popups
         overlay started all four platform rooms and held six
         durable objects resident for as long as it was open —
         four upstream connections nobody was listening to.

         The flag only ever removes capability, so a client
         setting it maliciously would just deny itself chat.
      --------------------------------------------------------- */
      const isPopupsSender = url.searchParams.get("role") === "popups";

      if (!isPopupsSender) {
        // Start the platform readers if they aren't already going.
        // Must go through waitUntil: this response returns
        // immediately, and an un-awaited subrequest would be
        // cancelled before it ever reached the durable object.
        if (ctx?.waitUntil) {
          ctx.waitUntil(wakeBeam(env));
          ctx.waitUntil(wakeArena(env));
          ctx.waitUntil(wakeVpzone(env));
          ctx.waitUntil(wakeOdysee(env));
          ctx.waitUntil(wakeBitchute(env));
          ctx.waitUntil(wakeFacebook(env));
        } else {
          await wakeBeam(env);
          await wakeArena(env);
          await wakeVpzone(env);
          await wakeOdysee(env);
          await wakeBitchute(env);
          await wakeFacebook(env);
        }
      }

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      const room = env.ChatRoom.get(id);

      // Tell the durable object how this socket was authorised.
      // Set here, never read from the client.
      const headers = new Headers(request.headers);
      headers.set("x-gac-readonly", readOnly ? "1" : "0");
      headers.set("x-gac-role", isPopupsSender ? "popups" : "chat");

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
       7d-e. Facebook OAuth  (/facebook/connect|callback)

       Both are deliberately UNKEYED. The Stream Deck button opens
       /connect directly, and a key in a URL leaks into browser
       history, referrer headers and proxy logs.

       What protects the token store is the identity check in the
       callback: only the configured owner's authorisation is
       saved. A stranger opening either URL authorises their own
       account and is turned away.
    --------------------------------------------------------- */
    if (url.pathname === "/facebook/connect") {
      try {
        return Response.redirect(await beginFacebookAuth(env), 302);
      } catch (err) {
        return new Response(`Facebook connect failed: ${err.message}`, {
          status: 500
        });
      }
    }

    if (url.pathname === "/facebook/callback") {
      const error = url.searchParams.get("error_description");
      if (error) return facebookPage("Authorisation cancelled", error, false);

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return facebookPage("Missing code", "No authorisation code returned.", false);
      }

      try {
        const result = await completeFacebookAuth(env, code, state);

        const days = Math.floor((result.expires_in || 0) / 86400);

        const pageList = result.pages.length
          ? result.pages.map((p) => `  • ${p.name}  (${p.id})`).join("\n")
          : "  (none — see below)";

        let note =
          `Pages stored:\n${pageList}\n\n` +
          `Page tokens do not expire — chat will keep working ` +
          `without any renewal.\n\n` +
          `The user token behind them lasts about ${days} days, and is ` +
          `only needed to discover Pages. If you add one to ` +
          `FACEBOOK_PAGE_IDS later, reconnect here so its token is ` +
          `stored — a deploy alone is not enough.`;

        if (result.skippedCount) {
          note +=
            `\n\n${result.skippedCount} other Page(s) you administer were ` +
            `skipped and their tokens discarded, because they are not in ` +
            `FACEBOOK_PAGE_IDS. Page tokens never expire, so we only keep ` +
            `the ones we actually use.`;
        }

        if (result.missing?.length) {
          note +=
            `\n\nWARNING — these ids are configured but were NOT returned ` +
            `by Facebook:\n  ${result.missing.join("\n  ")}\n` +
            `Check for a typo, or that you still administer them.`;
        }

        if (!result.pages.length) {
          note +=
            `\n\nNo Pages were stored. Either the app is missing the ` +
            `pages_show_list permission, you declined Page access on the ` +
            `consent screen, or FACEBOOK_PAGE_IDS matches none of them.`;
        }

        /* On the very first run there is no pinned owner, so the
           id is shown here to be put into config. It identifies
           the account only to this one app. */
        if (!result.pinned) {
          note +=
            `\n\nFirst run — add this to wrangler.jsonc so only your ` +
            `account can reconnect in future:\n\n` +
            `"FACEBOOK_OWNER_ID": "${result.user_id}"`;
        }

        return facebookPage(
          `Connected as ${result.user_name}`,
          note,
          result.pages.length > 0
        );
      } catch (err) {
        /* Not an error from the visitor's point of view — they
           signed in fine, they simply aren't the operator. Shown
           as a normal outcome rather than a red failure. */
        if (err.notOwner) {
          return facebookPage("Signed in — access restricted", err.message, true);
        }

        return facebookPage("Could not connect", err.message, false);
      }
    }

    /* ---------------------------------------------------------
       7d-f. Facebook control (/facebook/status|probe)

       `probe` is the capture step: it lists the live videos and
       pulls the comments on whichever is live, returning the RAW
       Graph API responses. That is what the transform gets
       written from — the shape of from{picture} in particular is
       not worth guessing at.

       Delete once the transform is verified.
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/facebook/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const action = url.pathname.split("/")[2];

      /* Room control. Separate from the token routes below,
         which need the stored token rather than the room. */
      if (action === "start" || action === "stop") {
        const id = env.FacebookRoom.idFromName("facebook-live-chat");
        return env.FacebookRoom.get(id).fetch(`https://do/${action}`);
      }

      if (action === "room") {
        const id = env.FacebookRoom.idFromName("facebook-live-chat");
        return env.FacebookRoom.get(id).fetch("https://do/status");
      }

      const token = await getFacebookToken(env);

      if (action === "status") {
        const status = describeToken(token);

        /* Configured but not stored — the one way the save-time
           allowlist can fail, and it would otherwise look like a
           Page that simply never goes live. */
        const configured = allowedPageIds(env);
        const held = (token?.pages || []).map((p) => p.id);

        status.configuredPageIds = configured;
        status.missingPageTokens = configured.filter((id) => !held.includes(id));

        if (status.missingPageTokens.length) {
          status.action =
            "Reconnect at /facebook/connect — these Pages are configured " +
            "but no token is stored for them. A deploy alone does not " +
            "fetch new Page tokens.";
        }

        return json(status);
      }

      /* ---------------------------------------------------------
         Which fields will the SSE endpoint actually accept?

         streaming-graph rejected our first attempt with a 400 and
         an HTML error page rather than Graph's usual JSON error,
         which says the query was refused before reaching the API.

         So the variants are tried in order, richest first, with a
         deliberate control that MUST fail — otherwise a wall of
         200s would tell us nothing. One call each, which matters:
         the whole app budget is 200 calls an hour.

         Delete once the working shape is baked into facebookRoom.
      --------------------------------------------------------- */
      if (action === "sse") {
        if (!token) return json({ ok: false, error: "not connected" });

        const pages = pageTokens(token);
        if (!pages.length) return json({ ok: false, error: "no Page tokens" });

        const page = pages[0];
        const pt = encodeURIComponent(page.access_token);

        // Resolve the live video the same way the room does.
        const lvRes = await fetch(
          `${FB_API}/${page.id}/live_videos?fields=id,status&limit=5&access_token=${pt}`
        );
        const lvJson = await lvRes.json();
        const live = (lvJson.data || []).find((v) => v.status === "LIVE");

        if (!live) {
          return json({ ok: false, error: "not live — start a broadcast first" });
        }

        /* The permalink carries a DIFFERENT video id to the live
           video id. Worth testing both, since which one this
           endpoint wants is exactly the sort of thing that
           produces a generic error rather than a helpful one. */
        const lv2 = await fetch(
          `${FB_API}/${live.id}?fields=permalink_url&access_token=${pt}`
        ).then((r) => r.json()).catch(() => ({}));

        const permalinkId =
          String(lv2?.permalink_url || "").match(/\/videos\/(\d+)/)?.[1] || null;

        const UA =
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

        const F = "from{name,id},message";

        const variants = [
          ["live id, Accept + UA", live.id, F, { Accept: "text/event-stream", "User-Agent": UA }],
          ["live id, UA only", live.id, F, { "User-Agent": UA }],
          ["live id, no headers", live.id, F, {}],
          ["live id, no fields", live.id, null, { "User-Agent": UA }],
          ["PERMALINK id", permalinkId, F, { "User-Agent": UA }],
          ["CONTROL: nonexistent id", "1", F, { "User-Agent": UA }]
        ];

        /* Strip style and script CONTENT before removing tags —
           otherwise the "message" is the error page's CSS, which
           is what the first version of this probe reported. */
        const readable = (html) =>
          String(html)
            .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&\w+;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 400);

        const results = [];

        for (const [label, videoId, fields, headers] of variants) {
          if (!videoId) {
            results.push({ label, skipped: "no id available" });
            continue;
          }

          const url =
            `https://streaming-graph.facebook.com/${videoId}/live_comments` +
            `?access_token=${pt}&comment_rate=one_per_two_seconds` +
            (fields ? `&fields=${encodeURIComponent(fields)}` : "");

          try {
            const res = await fetch(url, {
              headers,
              signal: AbortSignal.timeout(6000)
            });

            /* Success here is an INFINITE stream, so reading to
               completion would hang. Status answers it; cancel
               either way. */
            let sample = null;
            let contentType = res.headers.get("content-type");

            if (!res.ok) {
              sample = readable(await res.text().catch(() => ""));
            } else {
              try { await res.body?.cancel(); } catch {}
            }

            results.push({
              label,
              videoId,
              status: res.status,
              ok: res.ok,
              contentType,
              sample
            });
          } catch (err) {
            const msg = String(err?.message || err);
            const held = /timed out|aborted/i.test(msg);

            /* A timeout on a streaming endpoint means it CONNECTED
               and held the connection open — that is success. */
            results.push({
              label,
              videoId,
              status: held ? "OPEN (held connection)" : "error",
              ok: held,
              sample: msg.slice(0, 160)
            });
          }
        }

        return json(
          redactTokens({ liveVideoId: live.id, permalinkId, results })
        );
      }

      if (action === "probe") {
        if (!token) {
          return json({ ok: false, error: "not connected — open /facebook/connect" });
        }

        /* Named tokenStatus, not token: the value is expiry and
           connection state, and a key called `token` invites
           exactly the redaction mistake made above. */
        const out = { tokenStatus: describeToken(token) };

        /* Paging is noise AND the thing that carries a token in
           its URLs. Dropped before anything is returned. */
        const strip = (o) => {
          if (o && typeof o === "object") delete o.paging;
          return o;
        };

        /* ---------------------------------------------------
           Every Page is checked, not just one.

           Which Page is live is a runtime question — Benon has
           two and may add more — so the room resolves it per
           broadcast rather than reading an id from config. The
           probe mirrors that so what we test is what will run.

           Each Page is queried with ITS OWN token, never the
           user token. That is the whole point of the Page route:
           those tokens do not expire.
        --------------------------------------------------- */
        const pages = pageTokens(token);

        if (!pages.length) {
          return json(
            redactTokens({
              ...out,
              error:
                "no Pages returned. Check the app has pages_show_list and " +
                "that you are an admin of at least one Page, then reconnect."
            })
          );
        }

        out.pageResults = [];

        for (const page of pages) {
          const pt = encodeURIComponent(page.access_token);
          const result = { id: page.id, name: page.name, tasks: page.tasks };

          try {
            const liveRes = await fetch(
              `${FB_API}/${page.id}/live_videos` +
                `?fields=id,status,title,creation_time,permalink_url` +
                `&limit=5&access_token=${pt}`
            );
            result.liveVideos = strip(await liveRes.json());
            result.liveVideosStatus = liveRes.status;

            /* LIVE is the active broadcast. Others seen here are
               SCHEDULED_UNPUBLISHED, LIVE_STOPPED, VOD. */
            const live = (result.liveVideos?.data || []).find(
              (v) => v.status === "LIVE"
            );

            result.liveVideoId = live?.id || null;

            if (live) {
              /* `from` is the field to scrutinise. Facebook
                 omits it for commenters in some contexts, and a
                 comment with no name and no avatar would change
                 how this has to be rendered. */
              const cRes = await fetch(
                `${FB_API}/${live.id}/comments` +
                  `?fields=id,message,created_time,from{id,name,picture}` +
                  `&limit=10&access_token=${pt}`
              );
              result.comments = strip(await cRes.json());
              result.commentsStatus = cRes.status;
            } else {
              result.comments = null;
              result.note = "no live_videos entry with status LIVE on this Page";
            }
          } catch (err) {
            result.error = String(err?.message || err);
          }

          out.pageResults.push(result);
        }

        return json(redactTokens(out));
      }

      return new Response("Not found", { status: 404 });
    }

    /* ---------------------------------------------------------
       7d-d. BitChute control (/bitchute/status|start|stop)
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/bitchute/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const action = url.pathname.split("/")[2];
      if (!["start", "stop", "status"].includes(action)) {
        return new Response("Not found", { status: 404 });
      }

      const id = env.BitChuteRoom.idFromName("bitchute-live-chat");
      return env.BitChuteRoom.get(id).fetch(
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
