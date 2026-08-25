/* ---------------------------------------------------------
   ⭐ Shared Popups State (ABSOLUTE WS URLs — Cloudflare‑SAFE)
--------------------------------------------------------- */
/* ---------------------------------------------------------
   ⭐ Overlay key — taken from this page's query string and
   appended to the socket URLs. Load the popups overlay as
   /overlay/popups/?key=YOUR_OVERLAY_KEY once OVERLAY_KEY is
   set on the worker. Without a key the URLs are unchanged.
--------------------------------------------------------- */
function withKey(url) {
  let key = "";
  try {
    key = new URLSearchParams(location.search).get("key") || "";
  } catch {}

  if (!key) return url;
  return url + (url.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
}

const sharedPopups = {
  // Cloudflare popup WebSocket endpoint (MUST be absolute)
  wsURL: withKey("wss://givesachat-cloudflare.benonkoebsch.workers.dev/ws/popups"),

  // Chat overlay WebSocket endpoint (MUST be absolute)
  /* role=popups matters more than it looks.
   *
   * This socket is SEND-ONLY: the popups overlay uses it to push
   * reward and velora_system cards into the chat lane. It never
   * consumes Beam, Arena, VPZONE or Odysee messages.
   *
   * Without the flag the worker treats it like a chat overlay
   * and starts all four platform rooms — so opening the popups
   * overlay span up the entire ingestion pipeline and held six
   * durable objects resident for as long as it was open.
   */
  chatWSURL: withKey(
    "wss://givesachat-cloudflare.benonkoebsch.workers.dev/ws/chat"
  ) + "&role=popups",

  // Velora access token (loaded at runtime)
  veloraAccessToken: null,

  // WebSocket references
  ws: null,        // popups WebSocket
  chatWS: null,    // chat WebSocket

  // Sleep timer reference
  _sleepTimer: null
};

/* ---------------------------------------------------------
   ⭐ Detect iOS (Safari WebKit)
--------------------------------------------------------- */
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   ⭐ Chat WebSocket Reliability System
--------------------------------------------------------- */

const chatQueue = [];

/**
 * Ensure Chat WebSocket stays connected
 */
function ensureChatWS() {
  const ws = sharedPopups.chatWS;

  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  setTimeout(() => {
    sharedPopups.chatWS = new WebSocket(sharedPopups.chatWSURL);

    sharedPopups.chatWS.onopen = () => {
      flushChatQueue();
    };

    sharedPopups.chatWS.onclose = () => {
      const delay = isIOS ? 1500 : 1000;
      setTimeout(ensureChatWS, delay);
    };

    sharedPopups.chatWS.onerror = () => {
      try { sharedPopups.chatWS.close(); } catch {}
    };
  }, 100);
}

/**
 * Wait until Chat WS is ready
 */
function waitForChatWSReady() {
  return new Promise(resolve => {
    const check = () => {
      const ws = sharedPopups.chatWS;
      if (ws && ws.readyState === WebSocket.OPEN) {
        resolve();
      } else {
        setTimeout(check, 150);
      }
    };
    check();
  });
}

/**
 * Flush queued messages once WS is ready
 */
function flushChatQueue() {
  const ws = sharedPopups.chatWS;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  while (chatQueue.length > 0) {
    const msg = chatQueue.shift();
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      chatQueue.unshift(msg);
      break;
    }
  }
}

/**
 * ⭐ Send message to Chat Overlay (bulletproof)
 */
export async function sendToChatOverlay(payload) {
  const ws = sharedPopups.chatWS;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    chatQueue.push(payload);
    await waitForChatWSReady();
  }

  try {
    sharedPopups.chatWS.send(JSON.stringify(payload));
  } catch (err) {
    chatQueue.push(payload);
  }
}

/* ---------------------------------------------------------
   ⭐ Heartbeat watchdog — keeps Chat WS alive forever
--------------------------------------------------------- */
setInterval(() => {
  ensureChatWS();
}, 3000);

/* ---------------------------------------------------------
   ⭐ Initial connect (with Brave/iOS delay)
--------------------------------------------------------- */
setTimeout(() => {
  ensureChatWS();
}, 120);

/* ---------------------------------------------------------
   ⭐ Load Velora Access Token
--------------------------------------------------------- */
export async function loadVeloraAccessToken() {
  try {
    const res = await fetch("/api/velora/access-token");

    if (!res.ok) {
      return sharedPopups.veloraAccessToken;
    }

    const json = await res.json();
    const token = json.access_token || null;

    if (!token) {
      return sharedPopups.veloraAccessToken;
    }

    sharedPopups.veloraAccessToken = token;
    return sharedPopups.veloraAccessToken;
  } catch (err) {
    return sharedPopups.veloraAccessToken;
  }
}

/* ---------------------------------------------------------
   ⭐ WAKE FUNCTION — restores popups wake behavior
--------------------------------------------------------- */
sharedPopups.wake = function () {
  try {
    const el = document.querySelector("#overlay-root");
    if (!el) return;

    // Wake immediately
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";

    // Reset sleep timer
    clearTimeout(sharedPopups._sleepTimer);

    sharedPopups._sleepTimer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    }, 15000); // same sleep timeout as chat overlay
  } catch (err) {
    console.warn("[Popups] Wake failed:", err);
  }
};

/* ---------------------------------------------------------
   ⭐ Popups Heartbeat — prevents Cloudflare idle disconnect
--------------------------------------------------------- */
setInterval(() => {
  try {
    const ws = sharedPopups.ws;
    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  } catch {}
}, 25000); // 25s heartbeat

/* ---------------------------------------------------------
   ⭐ Zombie Socket Detector — OBS/CEF fix
--------------------------------------------------------- */
let lastPopupEvent = Date.now();

sharedPopups.markPopupEvent = function () {
  lastPopupEvent = Date.now();
};

setInterval(() => {
  const ws = sharedPopups.ws;
  if (!ws) return;

  const now = Date.now();
  const idle = now - lastPopupEvent;

  /* ---------------------------------------------------------
     Force a reconnect THROUGH THE MANAGER.

     This used to build its own `new WebSocket(...)` and assign it
     here. That socket had no onmessage, no onclose, no handlers of
     any kind — it could not deliver an event, could not mark
     activity, and so was replaced by another orphan five minutes
     later, forever.

     The manager owns reconnection: it tears the old socket down,
     re-attaches handlers and applies the generation guard. Asking
     it is the only way to get a socket that actually works.
  --------------------------------------------------------- */
  if (idle > 5 * 60 * 1000) {
    lastPopupEvent = now;

    if (typeof sharedPopups.reconnect === "function") {
      sharedPopups.reconnect();
    }
  }
}, 60000); // check every minute

export default sharedPopups;
