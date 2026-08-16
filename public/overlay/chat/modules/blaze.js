// public/overlay/chat/modules/blaze.js

import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";
import { withKey, overlayKey } from "/overlay/shared/_shared.js";
import { handleChat } from "./chatRenderer.js";
import { getMessagesContainer } from "./websocket.js";

/* ---------------------------------------------------------
   Blaze chat

   Blaze delivers events over Socket.IO, which does not run in
   a Cloudflare Worker — so unlike Beam (plain SSE, read in a
   durable object) this connection lives in the overlay.

   The flow:
     1. connect to https://blaze.stream, path /ws
     2. wait for eventsub -> metadata.messageType session_welcome
     3. POST the sessionId to our worker
     4. the worker subscribes that session using the app access
        token, so no Blaze credential ever reaches the browser
     5. chat notifications arrive on the same socket

   Messages render locally rather than being pushed back
   through ChatRoom. Every overlay holds its own connection, so
   relaying would multiply each message by the number of open
   overlays.
--------------------------------------------------------- */

const BLAZE_ORIGIN = "https://blaze.stream";
const SUBSCRIBE_ENDPOINT = "/api/blaze/subscribe";

let socket = null;
let resubscribeTimer = null;

/* ---------------------------------------------------------
   Blaze sends `message` as plain text, so it must be escaped
   before it reaches innerHTML — the overlay does no sanitising
   of its own.
--------------------------------------------------------- */
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------------------------------------------------------
   Custom emotes — PARTIALLY RESOLVED

   Messages carry an emote token inline:

     "emote test[emote:2f733d36-16bb-4a05-bb3f-1d7e73634a6e]"

   That uuid is the EMOTE ID, not the image filename. The same
   emote (:ANGRYPYRO2:) renders in Blaze's own client as

     cdn.blaze.stream/uploads/emote/8e447717-...-e9a6d5b02071.png

   — a different uuid entirely. So the CDN URL cannot be built
   from the token alone, and Blaze publishes no emotes endpoint
   to resolve one to the other. Question outstanding with Blaze.

   Until that lands, the img is emitted anyway but hides itself
   if it fails to load, so a broken image never reaches the
   stream. When the real mapping is known, only buildEmoteUrl()
   below needs to change.

   The uuid is matched strictly rather than with a loose
   wildcard: this string goes straight into a src attribute,
   and message text is attacker-controlled.
--------------------------------------------------------- */
const EMOTE_TOKEN =
  /\[emote:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

const BLAZE_EMOTE_CDN = "https://cdn.blaze.stream/uploads/emote/";

function buildEmoteUrl(emoteId) {
  // Known to be wrong for now — see the note above.
  return `${BLAZE_EMOTE_CDN}${emoteId.toLowerCase()}.png`;
}

function renderBlazeEmotes(html) {
  return html.replace(EMOTE_TOKEN, (_match, uuid) => {
    const src = buildEmoteUrl(uuid);

    /* onerror is safe here: this markup is ours, not user
       input, and the uuid has already been pattern-matched.
       Removing the node beats showing a broken image icon
       mid-stream. */
    return `<img class="blaze-emote-img" src="${src}" alt="" onerror="this.remove()">`;
  });
}

/* Unicode emoji get scaled to match, via the existing
   .blaze-emote rule. Runs after emote substitution — the img
   tag it produces contains no emoji, so it is unaffected. */
function scaleBlazeEmotes(html) {
  return html.replace(
    /([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/gu,
    '<span class="blaze-emote">$1</span>'
  );
}

function toChatPayload(payload) {
  const sender = payload?.sender || {};

  return {
    type: "chat",
    platform: "blaze",

    messageId: payload?.messageId || null,
    username: sender.displayName || sender.username || "Unknown",
    avatar: sender.avatarUrl || null,

    // renderBlazeBadges() reads roles from `badges`, plus isOwner
    badges: Array.isArray(sender.roles) ? sender.roles : [],
    isOwner: sender.isOwner === true,
    isSubscriber: sender.isSubscriber === true,

    html: scaleBlazeEmotes(renderBlazeEmotes(escapeHtml(payload?.message))),

    timestamp: payload?.createdAt ? Date.parse(payload.createdAt) : Date.now()
  };
}

async function subscribeSession(sessionId) {
  try {
    const res = await fetch(withKey(SUBSCRIBE_ENDPOINT), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId })
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json.ok) {
      console.warn("[Blaze] subscribe failed:", res.status, json);
      return false;
    }

    console.log("[Blaze] subscribed to chat for session", sessionId);
    return true;
  } catch (err) {
    console.warn("[Blaze] subscribe request failed:", err);
    return false;
  }
}

function handleEventSub(message) {
  const { metadata, payload } = message || {};
  if (!metadata) return;

  /* A fresh sessionId is issued on every (re)connect, and
     subscriptions are bound to it — so this must run again
     after any reconnect, not just the first time. */
  if (metadata.messageType === "session_welcome") {
    const sessionId = payload?.sessionId;
    if (!sessionId) return;

    clearTimeout(resubscribeTimer);

    subscribeSession(sessionId).then((ok) => {
      if (ok) return;
      // Retry once shortly after — a cold worker or a brief
      // Blaze hiccup shouldn't cost the whole session.
      resubscribeTimer = setTimeout(() => subscribeSession(sessionId), 3000);
    });

    return;
  }

  if (metadata.subscriptionType !== "channel.chat.message") return;

  /* Any other bracketed token is an embed type we don't handle
     yet — log it rather than letting it render as raw text. */
  const unknown = String(payload?.message || "")
    .replace(EMOTE_TOKEN, "")
    .match(/\[[a-z]+:[^\]]+\]/gi);

  if (unknown) {
    console.warn("[Blaze] unhandled message token(s):", unknown.join(", "));
  }

  const chatPayload = toChatPayload(payload);
  if (!chatPayload.html.trim()) return;

  const container = getMessagesContainer();
  if (!container) return;

  handleChat(chatPayload, container);
}

export function setupBlazeChat() {
  // No overlay key means the subscribe endpoint would reject us.
  if (!overlayKey()) {
    console.warn("[Blaze] no overlay key in URL — chat disabled");
  }

  if (socket) {
    try { socket.close(); } catch {}
  }

  socket = io(BLAZE_ORIGIN, {
    path: "/ws",
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000
  });

  socket.on("connect", () => console.log("[Blaze] socket connected"));

  socket.on("eventsub", (message) => {
    try {
      handleEventSub(
        typeof message === "string" ? JSON.parse(message) : message
      );
    } catch (err) {
      console.warn("[Blaze] bad eventsub payload:", err);
    }
  });

  socket.on("connect_error", (err) =>
    console.warn("[Blaze] connect error:", err?.message || err)
  );

  socket.on("disconnect", (reason) =>
    console.log("[Blaze] disconnected:", reason)
  );
}
