// public/overlay/chat/modules/websocket.js

import _shared, { withKey } from "/overlay/shared/_shared.js";
import { handleReward } from "./rewardRenderer.js";
import { handleChat, renderVeloraSystemMessage } from "./chatRenderer.js";
import { handleVeloraStreamAlert } from "./alertRenderer.js";

/* ---------------------------------------------------------
   ⭐ DEDUPE — 1 second window

   ⚠️ THIS DROPPED REAL CHAT MESSAGES FOR MONTHS.

   The key used to be read exclusively out of payload.data:

     username: payload.data?.username
     amount:   payload.data?.amount
     message:  payload.data?.message

   Alerts and rewards are nested that way. A CHAT payload is
   flat — payload.username, payload.html, no `data` at all — so
   all three fields came back undefined for every chat message,
   and every chat message produced the identical key:

     { type: "chat", event: undefined, username: undefined,
       amount: undefined, message: undefined }

   Which made any two chat messages arriving within one second
   of each other duplicates of one another. The second was
   discarded, silently, on the client.

   It presented as "Beam is slow" and "quick messages get
   skipped", and it survived a look at the SSE parser, the
   worker, and the relay, because none of those were wrong. A
   42-message Stream Deck run posted five seconds apart still
   lost half: Beam relays in bursts, so messages sent seconds
   apart can land in the same second at the overlay.

   Now: dedupe on a real id when the payload carries one, which
   is the only thing that can distinguish two messages reliably.
   Fall back to a content key that reads BOTH shapes — flat and
   nested — so a genuine double-send is still caught.
--------------------------------------------------------- */
let lastEvents = [];
const DEDUPE_WINDOW = 1000;

function dedupeKey(payload) {
  // Alerts and rewards nest under .data; chat is flat.
  const d = payload?.data || payload;

  /* A unique id beats any content comparison: two viewers can
     legitimately post the same words in the same second, and
     that is not a duplicate. */
  const id =
    payload?.messageId ||
    d?.messageId ||
    d?.redemptionId ||
    d?.id ||
    null;

  if (id) return `${payload?.type}|id:${id}`;

  return [
    payload?.type,
    payload?.event,
    d?.alertType,
    d?.displayName ?? d?.username,
    d?.amount ?? d?.volts ?? d?.viewers,
    /* html for chat, message for alerts — the actual content
       under whichever name this payload type uses. */
    d?.message ?? d?.html ?? d?.text,
    d?.place
  ]
    .map((v) => (v === undefined || v === null ? "" : String(v)))
    .join("|");
}

function isDuplicate(payload) {
  const now = Date.now();
  const key = dedupeKey(payload);

  lastEvents = lastEvents.filter((e) => now - e.ts < DEDUPE_WINDOW);

  if (lastEvents.some((e) => e.key === key)) {
    console.warn("[Overlay] duplicate suppressed:", key.slice(0, 80));
    return true;
  }

  lastEvents.push({ key, ts: now });
  return false;
}

/* ---------------------------------------------------------
   ⭐ POPUP (unchanged)
--------------------------------------------------------- */
function showRewardPopup(payload) {
  const popupRoot = document.getElementById("reward-popup");
  if (!popupRoot) return;

  const popupIcon =
    payload.rewardIcon ||
    payload.icon?.customIconUrl ||
    payload.icon?.emoteUrl ||
    payload.itemIconUrl;

  if (!popupIcon) return;

  const img = document.createElement("img");
  img.className = "reward-popup-image";
  img.src = popupIcon;

  popupRoot.appendChild(img);

  setTimeout(() => {
    img.classList.add("fade-out");
    setTimeout(() => img.remove(), 800);
  }, 2500);
}

/* ---------------------------------------------------------
   ⭐ CHAT CONTAINER
--------------------------------------------------------- */
function getMessagesContainer() {
  return document.getElementById("messages");
}

/* ---------------------------------------------------------
   ⭐ BROADCAST HANDLER — Velora preserved, Beam fixed
--------------------------------------------------------- */
function handleBroadcast(payload) {
  const container = getMessagesContainer();
  if (!container) return;

  if (payload.type === "velora_system") {
    renderVeloraSystemMessage("channel.stream_alert", payload.data, container);
    return;
  }

  if (payload.type === "reward" && payload.platform === "velora") {
    /* ---------------------------------------------------------
       ⭐ A REWARD WITH NO NAME IS NOT A REWARD.

       The 1st/2nd GIVER claims kept landing in the chat lane as a
       bare "Reward" card — the literal fallback string in
       veloraRewardCard.js when rewardTitle, rewardName and title
       are all missing.

       Claims are excluded at three points upstream now, each
       keyed on a different field name, and one of them is still
       letting these through. Rather than guess at a fourth field
       name — three guesses have already missed — this refuses to
       render the thing that cannot be rendered meaningfully.

       Volts tips are exempt on purpose: they legitimately carry
       no reward name and take the other branch in the card, where
       the amount supplies the text.

       This is a backstop, not the fix. The payload is logged so
       the real field name can be read off a live claim and the
       exclusion put back where it belongs.
    --------------------------------------------------------- */
    const rewardName = payload.rewardTitle || payload.rewardName || payload.title;

    const voltsAmount =
      payload.volts ?? payload.amount ?? payload.templateData?.amount ?? null;

    if (!rewardName && typeof voltsAmount !== "number") {
      console.warn(
        "[Overlay] nameless reward suppressed in the chat lane. Keys:",
        Object.keys(payload).join(", "),
        payload
      );
      return;
    }

    handleReward(payload, container);
    showRewardPopup(payload);
    return;
  }

  if (payload.type === "chat") {
    // Velora (and any flat payloads) stay as-is
    if (!payload.data || payload.platform === "velora") {
      handleChat(payload, container);
      return;
    }

    // Beam / external / anything using { data: { ... } }
    const merged = {
      platform: payload.platform,
      ...payload.data
    };

    handleChat(merged, container);
    return;
  }

  if (payload.type === "velora_alert") {
    handleVeloraStreamAlert(payload.data);
    return;
  }
}

/* ---------------------------------------------------------
   ⭐ MAIN OVERLAY WEBSOCKET — FIXED
--------------------------------------------------------- */
let socket = null;
let heartbeat = null;
let reconnectTimer = null;
let isReconnecting = false;

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function setupSocket() {
  const wsURL = withKey(
    "wss://givesachat-cloudflare.benonkoebsch.workers.dev/ws/chat"
  );

  if (socket && socket.readyState === WebSocket.OPEN) {
    try { socket.close(); } catch {}
  }

  setTimeout(() => {
    socket = new WebSocket(wsURL);

    socket.addEventListener("open", () => {
      startHeartbeat();
      console.log("[Overlay WS] Connected");
    });

    socket.addEventListener("close", () => {
      reconnect();
    });

    socket.addEventListener("error", () => {
      reconnect();
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (isDuplicate(payload)) return;
        handleBroadcast(payload);
      } catch {}
    });
  }, 100);
}

/* ---------------------------------------------------------
   ⭐ Heartbeat
--------------------------------------------------------- */
function startHeartbeat() {
  clearInterval(heartbeat);

  heartbeat = setInterval(() => {
    if (!socket) return;

    if (socket.readyState !== WebSocket.OPEN) {
      reconnect();
    }
  }, 3000);
}

/* ---------------------------------------------------------
   ⭐ Reconnect
--------------------------------------------------------- */
function reconnect() {
  if (isReconnecting) return;
  isReconnecting = true;

  clearInterval(heartbeat);
  clearTimeout(reconnectTimer);

  const delay = isIOS ? 1500 : 300;

  reconnectTimer = setTimeout(() => {
    isReconnecting = false;
    setupSocket();
  }, delay);
}

/* ---------------------------------------------------------
   ⭐ iOS: WAKE UP AND CHECK, RATHER THAN TRUST readyState.

   The heartbeat above only asks whether readyState is OPEN.
   On iPad that is not enough. When the screen sleeps, the app
   backgrounds, or the network hands over — which on a road trip
   is constantly — iOS can leave a socket reporting OPEN while
   it is dead. Nothing arrives, no close event fires, and the
   heartbeat sees OPEN and does nothing. The overlay sits there
   looking fine and receiving nothing, until the page is
   reloaded by hand.

   That fits the report exactly: alerts missing on the iPad but
   present in OBS, from the same single broadcast. Nothing
   server-side can treat two sockets differently — ChatRoom
   sends one payload to every socket it holds — so a difference
   between two clients can only be one of them not listening.

   Chat gaps in that state go unnoticed because chat is bursty
   anyway. A follow alert that never appears is obvious.

   These two events are the cheap half of the fix: both are
   moments where iOS has demonstrably just changed something
   underneath us, and both only act when the socket is already
   not OPEN, so there are no false reconnects on a quiet lane.
--------------------------------------------------------- */
function reconnectIfDead(reason) {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  console.log(`[Overlay WS] ${reason} — socket not open, reconnecting`);
  reconnect();
}

if (typeof window !== "undefined") {
  // Network handover: new tower, wifi to cellular, tunnel.
  window.addEventListener("online", () => reconnectIfDead("came back online"));

  // Screen woke, app returned to the foreground.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      reconnectIfDead("page became visible");
    }
  });

  // iOS fires this when restoring a page from the back/forward cache.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) reconnectIfDead("restored from bfcache");
  });
}

export {
  setupSocket,
  handleBroadcast,
  getMessagesContainer
};

