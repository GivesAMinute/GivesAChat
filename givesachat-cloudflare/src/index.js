import { VERSION } from "./version.js";

import { ChatRoom } from "./chatRoom.js";
import { PopupRoom } from "./popupRoom.js";
import { BeamRoom } from "./beamRoom.js";
import { ArenaRoom } from "./arenaRoom.js";
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
import { buildRewardPlan, DEFAULT_MAX } from "./rewardPlan.js";
import {
  VeloraTokenStore,
  putOAuthState,
  takeOAuthState,
  saveRewardSnapshot,
  getRewardSnapshot
} from "./veloraTokenStore.js";
import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { subscribeBlazeSession } from "./blazeAuth.js";
import { getBlazeEmoteMap } from "./blazeEmotes.js";

export {
  ChatRoom,
  VeloraTokenStore,
  PopupRoom,
  BeamRoom,
  ArenaRoom,
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

      /* ---------------------------------------------------------
         VIEWERS CONSUME CHAT. THEY DO NOT SUMMON IT.

         The public pop-out at bjwok.com/chat authenticates with
         VIEWER_KEY, which marks the socket read-only. Until now
         it also fired all six platform wakes — so a viewer who
         opened the page while nothing was streaming and left the
         tab open overnight kept six durable objects resident
         until they closed it.

         That is a stranger's browser tab deciding what our bill
         is. A read-only client should receive whatever is already
         flowing and start nothing: if the operator isn't
         streaming, there is nothing for them to see anyway.

         Same principle as the popups socket, arrived at from the
         other direction — before wiring a connection to "someone
         is watching", ask whether it should be allowed to START
         anything.
      --------------------------------------------------------- */
      if (!isPopupsSender && !readOnly) {
        // Start the platform readers if they aren't already going.
        // Must go through waitUntil: this response returns
        // immediately, and an un-awaited subrequest would be
        // cancelled before it ever reached the durable object.
        if (ctx?.waitUntil) {
          ctx.waitUntil(wakeBeam(env));
          ctx.waitUntil(wakeArena(env));
          ctx.waitUntil(wakeOdysee(env));
          ctx.waitUntil(wakeBitchute(env));
          ctx.waitUntil(wakeFacebook(env));
        } else {
          await wakeBeam(env);
          await wakeArena(env);
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

      let result;

      try {
        result = await exchangeAuthCode(code, env);
      } catch (err) {
        /* A stranger completing the flow gets a plain refusal and
           no detail. The existing token is untouched — the owner
           check runs before anything is written. */
        if (err?.notOwner) {
          return new Response(
            "This overlay is linked to a different Velora channel. Nothing was changed.",
            { status: 403, headers: { "Content-Type": "text/plain" } }
          );
        }
        throw err;
      }

      if (!result?.accessToken) {
        return new Response("Failed to authorize Velora", { status: 500 });
      }

      /* ---------------------------------------------------------
         The granted scopes are shown back, because a scope that
         was requested and quietly not granted is otherwise only
         discovered much later as a 403 from whichever call needed
         it. This page is only ever seen by whoever just authorised
         — and it deliberately prints the scopes, never the token.
      --------------------------------------------------------- */
      const granted = String(result.scope || "").split(/\s+/).filter(Boolean);
      const wanted = ["channel:points:redeem", "channel:points:write"];
      const missing = wanted.filter((s) => !granted.includes(s));

      return new Response(
        [
          "Velora authorized. You can close this window.",
          "",
          `Scopes granted (${granted.length}):`,
          ...granted.map((s) => `  ${s}`),
          "",
          missing.length
            ? `NOT GRANTED: ${missing.join(", ")}`
            : "Both channel:points scopes are present."
        ].join("\n"),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
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

    /* ---------------------------------------------------------
       Velora reward sounds — proxied, because of CORS

       The overlay used to fetch this straight from
       api.velora.tv. That stopped working when Velora removed
       the Access-Control-Allow-Origin header:

         blocked by CORS policy: No 'Access-Control-Allow-Origin'
         header is present on the requested resource

       Every channel-point sound silently vanished — in OBS, on
       the iPad, everywhere — because the map was empty and an
       empty map looks exactly like a missing sound.

       CORS is a BROWSER rule. A worker fetching the same URL
       server-side is unaffected, so proxying it restores the
       sounds and makes us immune to them changing that header
       again in either direction.
    --------------------------------------------------------- */
    if (url.pathname === "/api/velora/reward-sounds" && request.method === "GET") {
      const auth = checkKey(request, url, env.OVERLAY_KEY);

      if (!auth.ok) {
        const viewer = checkKey(request, url, env.VIEWER_KEY);
        if (!viewer.ok || viewer.unconfigured) return unauthorized();
      }

      const channel = env.VELORA_CHANNEL_ID || "4f1cb975-eace-4650-8246-053007bd0036";

      try {
        const res = await fetch(
          `https://api.velora.tv/api/channel-points/${channel}/items/with-built-in`,
          {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(8000)
          }
        );

        if (!res.ok) {
          return json({ ok: false, error: `velora -> ${res.status}`, items: [] }, 200);
        }

        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];

        /* Only what the overlay needs: an id and a sound url.
           Relaying the whole 80 KB payload would put a lot of
           unrelated channel-point config through our worker on
           every overlay load. */
        const sounds = items
          .filter((i) => i?.id && (i.alertSoundUrl || i.soundUrl))
          .map((i) => ({
            id: i.id,
            url: i.alertSoundUrl || i.soundUrl,
            volume: Number(i.itemSoundVolume) || 1
          }));

        return new Response(
          JSON.stringify({ ok: true, count: sounds.length, sounds }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300"
            }
          }
        );
      } catch (err) {
        /* Never fail hard: the overlay treats an empty list as
           "no sounds", which is exactly right, and chat keeps
           working. */
        return json(
          { ok: false, error: String(err?.message || err), sounds: [] },
          200
        );
      }
    }

    /* ---------------------------------------------------------
       ⭐ VELORA FONTS — PROXIED, FOR THE SAME REASON AS THE SOUNDS

       veloraRendererPopups.js fetched api.velora.tv/fonts and
       /api/fonts/custom straight from the browser. Velora removed
       their Access-Control-Allow-Origin header, so both now fail:

         [Popups] Failed to load Velora fonts: TypeError: Failed to fetch

       The catch swallows it, so the only symptom is alert cards
       silently rendering in a fallback face instead of the Russo
       One / Bangers / Poppins the card design asks for. This was
       flagged as a risk when the reward sounds broke the same way;
       it has now happened.

       CORS binds browsers, not servers. Fetching the same two
       endpoints here and serving them from our own origin puts
       them out of reach of any further header changes at their
       end.

       Both are fetched together because the renderer needs both
       before it can draw, and one round trip beats two.
    --------------------------------------------------------- */
    /* ---------------------------------------------------------
       ⭐ REWARD AUDIT — READ ONLY. WRITES NOTHING.

       Velora resolves ^commands natively, and the trigger is the
       reward NAME with spaces stripped. There is no slug field,
       so the name is the only lever on how long a command is:

         "What A Beautiful Group Of People"
           -> ^WhatABeautifulGroupOfPeople   (28 characters)

       Which is slower to type than searching the list, defeating
       the point. This lists what every current reward actually
       resolves to, so the renaming is decided against real data
       rather than the two examples we happened to look at.

       TWO TRIGGERS ARE COMPUTED ON PURPOSE. Cory said "spaces
       stripped"; whether punctuation also goes is unconfirmed.
       "This Is Reality (Russell Brand)" is either
       ^ThisIsReality(RussellBrand) or ^ThisIsRealityRussellBrand
       depending on the answer, and the two disagree about
       collisions. Any name carrying punctuation is flagged rather
       than guessed at.
    --------------------------------------------------------- */
    /* ---------------------------------------------------------
       NOTE THE QUERY GUARDS.

       This route matched /api/velora/rewards on the PATH alone,
       and it sits earlier in the file than the ?keys=1 and
       ?snapshot=1 probes. So it answered them too, returning this
       trimmed audit and making both probes unreachable — they
       looked correct in the source and could never run.

       The symptom was worse than a 404 would have been: a
       perfectly plausible JSON response to a question it had not
       been asked, twice, which read as "the field is not there"
       rather than "you never reached the code that checks".

       Any new sub-mode of this path needs adding here too.
    --------------------------------------------------------- */
    if (
      url.pathname === "/api/velora/rewards" &&
      request.method === "GET" &&
      url.searchParams.get("keys") !== "1" &&
      url.searchParams.get("snapshot") !== "1"
    ) {
      const auth = checkKey(request, url, env.OVERLAY_KEY);
      if (!auth.ok) return unauthorized();

      const token = await getVeloraAccessToken(env);
      if (!token) return json({ ok: false, error: "no velora token" }, 200);

      try {
        const res = await fetch(
          "https://api.velora.tv/api/integrations/oauth/channel-points/rewards",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json"
            },
            signal: AbortSignal.timeout(8000)
          }
        );

        if (!res.ok) {
          const body = await res.text();
          return json(
            { ok: false, status: res.status, error: body.slice(0, 300) },
            200
          );
        }

        const data = await res.json();
        const list = Array.isArray(data) ? data : data?.rewards || data?.items || [];

        const rows = list.map((r) => {
          const name = String(r?.name || "");
          const spacesOnly = name.replace(/\s+/g, "");
          const alnumOnly = name.replace(/[^a-zA-Z0-9]/g, "");

          return {
            id: r?.id || null,
            name,
            cost: r?.cost ?? null,
            enabled: r?.enabled !== false,
            trigger: `^${spacesOnly}`,
            length: spacesOnly.length,
            /* Only meaningful where the two differ — i.e. the name
               contains something that is neither letter nor digit. */
            ifPunctuationStripped:
              spacesOnly === alnumOnly ? null : `^${alnumOnly}`,
            description: String(r?.description || "").slice(0, 120)
          };
        });

        /* Case-insensitive, because that is how Velora matches.
           Two rewards whose names differ only in capitalisation
           are one command, and one of them can never fire. */
        const seen = new Map();
        for (const r of rows) {
          const k = r.trigger.toLowerCase();
          seen.set(k, (seen.get(k) || 0) + 1);
        }
        for (const r of rows) {
          r.collides = seen.get(r.trigger.toLowerCase()) > 1;
        }

        rows.sort((a, b) => b.length - a.length);

        return json(
          {
            ok: true,
            total: rows.length,
            collisions: rows.filter((r) => r.collides).length,
            over15chars: rows.filter((r) => r.length > 15).length,
            withPunctuation: rows.filter((r) => r.ifPunctuationStripped).length,
            rewards: rows
          },
          200
        );
      } catch (err) {
        return json({ ok: false, error: String(err?.message || err) }, 200);
      }
    }

    /* ---------------------------------------------------------
       ⭐ PUBLIC COMMAND LIST — no key, deliberately.

       This is what viewers open. It cannot require OVERLAY_KEY,
       and it must not touch the broadcaster token: it reads the
       PUBLIC channel-points endpoint, so there is no credential
       anywhere in this path to leak.

       Read live rather than baked into a page, so adding a reward
       on Velora publishes its command with no deploy and nothing
       to remember. A list viewers cannot trust is worse than no
       list, and any list maintained by hand eventually lies.

       Proxied rather than fetched from the browser for the reason
       written on the reward sounds and the fonts: Velora has
       removed CORS headers three times now, and each time it took
       out whatever was calling them client-side.
    --------------------------------------------------------- */
    if (url.pathname === "/api/commands" && request.method === "GET") {
      const channel = env.VELORA_CHANNEL_ID;
      if (!channel) return json({ ok: false, error: "no channel configured" }, 200);

      try {
        const res = await fetch(
          `https://api.velora.tv/api/channel-points/${channel}/items`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) return json({ ok: false, error: `velora -> ${res.status}` }, 200);

        const data = await res.json();
        let items = Array.isArray(data) ? data : data?.items || [];

        /* ---------------------------------------------------------
           REDEMPTION COUNTS, IF THEY ARE THERE.

           totalRedemptions is definitely on the AUTHENTICATED
           rewards endpoint — it showed up in the key dump. Whether
           the public items endpoint carries it too is unknown, and
           guessing would mean a "most redeemed" sort that silently
           ordered everything by undefined.

           So: use the public list, and only if it has no counts at
           all, fetch them from the authenticated endpoint and merge
           by id. The public path stays the default and the token is
           only touched when it adds something.

           The token never leaves the worker either way — what goes
           out is a name and a number.
        --------------------------------------------------------- */
        const hasCounts = items.some((i) => Number.isFinite(Number(i?.totalRedemptions)));

        if (!hasCounts) {
          try {
            const token = await getVeloraAccessToken(env);
            if (token) {
              const authed = await fetch(
                "https://api.velora.tv/api/integrations/oauth/channel-points/rewards",
                {
                  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                  signal: AbortSignal.timeout(8000)
                }
              );
              if (authed.ok) {
                const aData = await authed.json();
                const aList = Array.isArray(aData) ? aData : aData?.rewards || aData?.items || [];
                const counts = new Map(aList.map((r) => [r?.id, r?.totalRedemptions]));
                items = items.map((i) => ({
                  ...i,
                  totalRedemptions: i?.totalRedemptions ?? counts.get(i?.id) ?? null
                }));
              }
            }
          } catch (err) {
            /* Counts are a nice-to-have. Losing them costs one sort
               option; failing the request would cost the whole page. */
            console.warn("[COMMANDS] count merge skipped:", err?.message || err);
          }
        }

        const commands = items
          .filter((i) => i?.name && i?.enabled !== false)
          .map((i) => ({
            /* The trigger is derived exactly as Velora derives it —
               name, spaces out, lower case. Not stored anywhere, so
               it cannot fall out of step with the real thing. */
            trigger: String(i.name).replace(/\s+/g, "").toLowerCase(),
            name: String(i.name),
            description: String(i.description || ""),
            cost: i.cost ?? null,
            icon: i.itemIconUrl || i.iconUrl || null,
            redemptions: Number.isFinite(Number(i.totalRedemptions))
              ? Number(i.totalRedemptions)
              : null
          }))
          .sort((a, b) => a.trigger.localeCompare(b.trigger));

        return new Response(
          JSON.stringify({
            ok: true,
            count: commands.length,
            /* Lets the page decide whether to offer a popularity
               sort, rather than showing a button that would order
               everything by null. */
            hasRedemptions: commands.some((c) => c.redemptions != null),
            commands
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              /* Five minutes. New rewards appear promptly without
                 every viewer's page hammering Velora. */
              "Cache-Control": "public, max-age=300",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      } catch (err) {
        return json({ ok: false, error: String(err?.message || err) }, 200);
      }
    }

    /* ---------------------------------------------------------
       ⭐ REWARD RENAMING — plan, apply, roll back.

       Naming logic lives in rewardPlan.js and is shared by all
       three, so the preview and the write cannot disagree.
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/api/velora/rewards")) {
      const auth = checkKey(request, url, env.OVERLAY_KEY);
      if (!auth.ok) return unauthorized();

      const token = await getVeloraAccessToken(env);
      if (!token) return new Response("no velora token", { status: 200 });

      const REWARDS_URL =
        "https://api.velora.tv/api/integrations/oauth/channel-points/rewards";
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

      const fetchRewards = async () => {
        const res = await fetch(REWARDS_URL, { headers });
        if (!res.ok) throw new Error(`rewards -> ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : data?.rewards || data?.items || [];
      };

      /* ---------------------------------------------------------
         ⭐ IS THE ROLLBACK SNAPSHOT STILL THERE?

         Read-only. The rollback route is the only other way to
         find out, and that one writes — which is no way to check
         whether a safety net exists before planning around it.

         Shows when it was taken and how many rewards it covers,
         plus a few names so it is obvious at a glance whether it
         holds the ORIGINAL long names or a second apply has
         already overwritten it with the short ones.
      --------------------------------------------------------- */
      if (url.pathname === "/api/velora/rewards" && url.searchParams.get("snapshot") === "1") {
        const snap = await getRewardSnapshot(env);

        if (!snap?.rewards?.length) {
          return new Response("No snapshot stored.", { status: 200 });
        }

        return new Response([
          `Snapshot taken ${new Date(snap.savedAt).toISOString()}`,
          `${snap.rewards.length} rewards recorded.`,
          ``,
          `First 8 names as recorded — these should be the LONG`,
          `originals. If they are already short, a second apply has`,
          `overwritten the snapshot and the originals are gone:`,
          ...snap.rewards.slice(0, 8).map((r) => `  ${r.name}`)
        ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      /* ---------------------------------------------------------
         ⭐ WHAT FIELDS DOES A REWARD ACTUALLY HAVE?

         Velora shipped a "Chat Command" field in the dashboard
         before documenting it — the API reference still lists only
         name, cost, description, cooldowns, approval and
         cardDesign. So the field exists and we do not know what it
         is called.

         Guessing at chatCommand / command / slug and PATCHing 163
         rewards to find out is exactly the mistake this project
         has made before: an endpoint that answers 200 while
         quietly ignoring an unrecognised key looks identical to
         success.

         So read it instead. This returns the union of every key
         present across the reward list, plus the value of anything
         command-shaped. Set a command on ONE reward in the
         dashboard, call this, and the real field name appears.

         Keys only, and only from reward config — there is no
         credential anywhere in a channel-points payload.
      --------------------------------------------------------- */
      if (url.pathname === "/api/velora/rewards" && url.searchParams.get("keys") === "1") {
        let list;
        try { list = await fetchRewards(); }
        catch (err) { return new Response(String(err.message), { status: 200 }); }

        const keys = new Set();
        for (const r of list) for (const k of Object.keys(r || {})) keys.add(k);

        /* Anything whose name hints at a command, with its value,
           for the rewards where one is actually set. */
        const hint = /command|slug|trigger|alias|shortcut|keyword/i;
        const commandish = [...keys].filter((k) => hint.test(k));

        const samples = [];
        for (const r of list) {
          for (const k of commandish) {
            if (r?.[k]) samples.push(`  ${r.name}  ->  ${k} = ${JSON.stringify(r[k])}`);
          }
        }

        return new Response([
          `${list.length} rewards.`,
          ``,
          `ALL KEYS SEEN:`,
          ...[...keys].sort().map((k) => `  ${k}`),
          ``,
          commandish.length
            ? `COMMAND-SHAPED KEYS: ${commandish.join(", ")}`
            : `No command-shaped key found. If you have not set a Chat`,
          commandish.length ? `` : `Command on any reward yet, set one and re-run this.`,
          ``,
          samples.length ? `SET ON:` : `None have a value set yet.`,
          ...samples
        ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      /* ---------------------------------------------------------
         ⭐ DOES commandCode ACTUALLY WRITE?

         The key exists on all 163 rewards, so the column is real.
         The dashboard accepts a value and loses it on save, which
         means either the UI never sends it, or the API ignores it
         too. Those are different bugs in different places.

         One reward, one field, then READ IT BACK. A PATCH that
         returns 200 proves nothing on its own — an API ignoring an
         unrecognised key looks exactly like an API accepting it.
         The only evidence that counts is the value coming back out.

         Deliberately scoped to a single reward passed by id. If
         the write turns out to be silently discarded, this will
         have changed nothing anywhere.
      --------------------------------------------------------- */
      if (url.pathname === "/api/velora/rewards/test-command" && request.method === "POST") {
        if (url.searchParams.get("confirm") !== "TEST") {
          return new Response("refused: add &confirm=TEST", { status: 400 });
        }

        const id = url.searchParams.get("id");
        const code = url.searchParams.get("code");
        if (!id || !code) {
          return new Response("need &id=<rewardId>&code=<command>", { status: 400 });
        }

        const patch = await fetch(`${REWARDS_URL}/${id}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ commandCode: code })
        });

        const patchBody = await patch.text();

        /* Read back from the list rather than trusting the PATCH
           response — the write is only real if a subsequent read
           can see it. */
        let after = null;
        try {
          const list = await fetchRewards();
          after = list.find((r) => r?.id === id) || null;
        } catch (err) {
          return new Response(`patched (${patch.status}) but re-read failed: ${err.message}`, { status: 200 });
        }

        const got = after?.commandCode ?? null;

        return new Response([
          `PATCH ${patch.status}`,
          `sent      commandCode = ${JSON.stringify(code)}`,
          `read back commandCode = ${JSON.stringify(got)}`,
          ``,
          got === code
            ? `WRITES. The API honours commandCode — the dashboard is the bug.`
            : got == null
              ? (patch.status === 400
                  ? `REFUSED. The column is in the read model but not in the\nupdate DTO's whitelist — see the raw response below. An\nexplicit 400 is the good version of this: a silent 200\nwould have looked identical to success.`
                  : `DISCARDED. The column exists but the write did not take,\nand the API did not say why.`)
              : `CHANGED. The API rewrote the value — note the difference above.`,
          ``,
          `raw PATCH response: ${patchBody.slice(0, 300)}`
        ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      /* ⭐ PLAN — writes nothing. */
      if (url.pathname === "/api/velora/rewards/plan" && request.method === "GET") {
        const max = Number(url.searchParams.get("max") || DEFAULT_MAX);
        let list;
        try { list = await fetchRewards(); }
        catch (err) { return new Response(String(err.message), { status: 200 }); }

        const { rows, clashes } = buildRewardPlan(list, { max });
        const pick = (a) => rows.filter((r) => r.action === a);

        const line = (r) =>
          `  ${r.name}\n      -> ${r.finalName}   ^${r.finalTrigger}  (${r.finalTrigger.length})` +
          (r.finalDescription ? "   << phrase appended to description" : "");

        return new Response([
          `REWARD RENAME PLAN — nothing has been written.`,
          clashes.length
            ? `\n!! ${clashes.length} DUPLICATE TRIGGER(S) — DO NOT APPLY:\n` +
              clashes.map((c) => `   ^${c.trigger}  <- ${c.names.join("  |  ")}`).join("\n")
            : `All ${rows.length} final triggers are unique.`,
          `${rows.length} rewards, threshold ${max} characters.`,
          ``,
          `M. HAND-PICKED (${pick("manual").length})`,
          ...pick("manual").map(line),
          ``,
          `A. DEPUNCTUATE ONLY (${pick("depunctuate").length}) — lossless`,
          ...pick("depunctuate").map(line),
          ``,
          `B. SHORTENED (${pick("shorten").length}) — review individually`,
          ...pick("shorten").map(line),
          ``,
          `D. UNCHANGED (${pick("none").length})`,
          ...pick("none").map((r) => `  ${r.name}  ^${r.finalTrigger}`),
          ``,
          `${rows.filter((r) => r.changed).length} rewards would change.`,
          `To apply:  POST /api/velora/rewards/apply?key=...&confirm=RENAME`
        ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      /* ---------------------------------------------------------
         ⭐ APPLY — the first thing here that touches the channel.

         POST, and a literal confirm=RENAME, so it cannot be fired
         by pasting a URL into a browser the way every read-only
         route in this file can.

         Order is the whole safety story:
           1. read every reward
           2. refuse outright on any duplicate trigger
           3. SNAPSHOT names and descriptions
           4. only then patch

         Sequential rather than parallel. 163 writes fired at once
         invite a 429 partway through, and a partial rename with an
         unknown boundary is far worse than a slow one. Each failure
         is recorded and the run continues, so one bad reward cannot
         strand the other 162.
      --------------------------------------------------------- */
      if (url.pathname === "/api/velora/rewards/apply" && request.method === "POST") {
        if (url.searchParams.get("confirm") !== "RENAME") {
          return new Response("refused: add &confirm=RENAME", { status: 400 });
        }

        const max = Number(url.searchParams.get("max") || DEFAULT_MAX);
        let list;
        try { list = await fetchRewards(); }
        catch (err) { return new Response(String(err.message), { status: 200 }); }

        const { rows, clashes } = buildRewardPlan(list, { max });

        if (clashes.length) {
          return new Response(
            `refused: ${clashes.length} duplicate trigger(s)\n` +
            clashes.map((c) => `  ^${c.trigger} <- ${c.names.join(" | ")}`).join("\n"),
            { status: 409 }
          );
        }

        const saved = await saveRewardSnapshot(
          env,
          list.map((r) => ({ id: r.id, name: r.name, description: r.description || "" }))
        );
        if (!saved) {
          return new Response("refused: could not save rollback snapshot", { status: 500 });
        }

        const changed = rows.filter((r) => r.changed && r.id);
        const done = [];
        const failed = [];

        for (const r of changed) {
          const body = { name: r.finalName };
          if (r.finalDescription) body.description = r.finalDescription;

          try {
            const res = await fetch(`${REWARDS_URL}/${r.id}`, {
              method: "PATCH",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            res.ok
              ? done.push(`${r.name} -> ${r.finalName}`)
              : failed.push(`${r.name}: HTTP ${res.status}`);
          } catch (err) {
            failed.push(`${r.name}: ${err?.message || err}`);
          }
        }

        return new Response([
          `Renamed ${done.length} of ${changed.length}.`,
          failed.length ? `FAILED ${failed.length}:` : `No failures.`,
          ...failed.map((f) => `  ${f}`),
          ``,
          `Rollback snapshot saved for all ${list.length}.`,
          `To undo:  POST /api/velora/rewards/rollback?key=...&confirm=ROLLBACK`,
          ``,
          ...done.map((d) => `  ${d}`)
        ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }

      /* ⭐ ROLLBACK — restore names and descriptions verbatim. */
      if (url.pathname === "/api/velora/rewards/rollback" && request.method === "POST") {
        if (url.searchParams.get("confirm") !== "ROLLBACK") {
          return new Response("refused: add &confirm=ROLLBACK", { status: 400 });
        }

        const snap = await getRewardSnapshot(env);
        if (!snap?.rewards?.length) {
          return new Response("no snapshot stored", { status: 404 });
        }

        const done = [];
        const failed = [];

        for (const r of snap.rewards) {
          try {
            const res = await fetch(`${REWARDS_URL}/${r.id}`, {
              method: "PATCH",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ name: r.name, description: r.description })
            });
            res.ok ? done.push(r.name) : failed.push(`${r.name}: HTTP ${res.status}`);
          } catch (err) {
            failed.push(`${r.name}: ${err?.message || err}`);
          }
        }

        return new Response([
          `Restored ${done.length} of ${snap.rewards.length}`,
          `from the snapshot taken ${new Date(snap.savedAt).toISOString()}.`,
          ...failed.map((f) => `  FAILED ${f}`)
        ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    }

    if (url.pathname === "/api/velora/fonts" && request.method === "GET") {
      const auth = checkKey(request, url, env.OVERLAY_KEY);

      if (!auth.ok) {
        const viewer = checkKey(request, url, env.VIEWER_KEY);
        if (!viewer.ok || viewer.unconfigured) return unauthorized();
      }

      const grab = async (endpoint) => {
        try {
          const res = await fetch(endpoint, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(8000)
          });
          if (!res.ok) {
            console.warn(`[VELORA] fonts ${endpoint} -> ${res.status}`);
            return null;
          }
          return await res.json();
        } catch (err) {
          console.warn(`[VELORA] fonts ${endpoint} failed:`, err?.message || err);
          return null;
        }
      };

      /* Settled, not raced: if the custom fonts are down the
         built-ins should still arrive, and vice versa. Losing one
         face is a cosmetic problem; losing both because one
         endpoint was slow is an avoidable one. */
      const [builtin, custom] = await Promise.all([
        grab("https://api.velora.tv/fonts"),
        grab("https://api.velora.tv/api/fonts/custom")
      ]);

      return new Response(
        JSON.stringify({ ok: true, builtin, custom }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            /* Fonts change about never. An hour keeps this off
               Velora's back and off our request count. */
            "Cache-Control": "public, max-age=3600"
          }
        }
      );
    }

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
       7d-c. Odysee control (/odysee/status|start|stop|resolve)

       `resolve` is a diagnostic — it confirms the shape of the
       LBRY proxy response used for avatars. Remove it once
       avatars are verified on stream.
    --------------------------------------------------------- */
    if (url.pathname.startsWith("/odysee/")) {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const action = url.pathname.split("/")[2];
      if (!["start", "stop", "status"].includes(action)) {
        return new Response("Not found", { status: 404 });
      }

      const id = env.OdyseeRoom.idFromName("odysee-live-chat");
      return env.OdyseeRoom.get(id).fetch(
        `https://do/${action}${url.search}`
      );
    }

    /* ---------------------------------------------------------
       7d-0. ChatRoom socket census (diagnostic)

       Answers "is anything actually connected right now?" — the
       question that decides whether the platform rooms are
       entitled to stay resident. Delete once the duration
       numbers are understood.
    --------------------------------------------------------- */
    if (url.pathname === "/chat/sockets") {
      const auth = checkKey(request, url, env.INGEST_KEY);
      if (!auth.ok) return unauthorized();

      const id = env.ChatRoom.idFromName("givesachat-main-v4");
      return env.ChatRoom.get(id).fetch("https://do/sockets");
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
