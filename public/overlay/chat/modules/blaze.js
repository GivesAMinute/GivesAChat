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
   Custom emotes

   Blaze embeds the emote's CDN id directly in the message text:

     "emote test[emote:685d034d-3a0b-4b4e-8dd3-f0b27ea21cdc]"

   which maps to
   cdn.blaze.stream/uploads/emote/<uuid>.png — so no lookup
   table or emotes endpoint is needed. (The ":CODE:" form seen
   in Blaze's own client is the img alt text, not the wire
   format.)

   The uuid is matched strictly rather than with a loose
   wildcard: this string goes straight into a src attribute,
   and message text is attacker-controlled.
--------------------------------------------------------- */
const EMOTE_TOKEN =
  /\[emote:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

const BLAZE_EMOTE_CDN = "https://cdn.blaze.stream/uploads/emote/";

function renderBlazeEmotes(html) {
  return html.replace(EMOTE_TOKEN, (_match, uuid) =>
    `<img class="blaze-emote-img" src="${BLAZE_EMOTE_CDN}${uuid.toLowerCase()}.png" alt="emote">`
  );
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
