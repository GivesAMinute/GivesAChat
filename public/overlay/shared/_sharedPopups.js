/* ---------------------------------------------------------
   ⭐ Shared Popups State
--------------------------------------------------------- */
const sharedPopups = {
  // Cloudflare popup WebSocket endpoint
  wsURL: `${location.origin.replace("http", "ws")}/ws/popups`,

  // Chat overlay WebSocket endpoint
  chatWSURL: `${location.origin.replace("http", "ws")}/ws/chat`,

  // Velora access token (loaded at runtime)
  veloraAccessToken: null,

  // WebSocket references
  ws: null,        // popups WebSocket
  chatWS: null     // chat WebSocket
};

/* ---------------------------------------------------------
   ⭐ Detect iOS (Safari WebKit)
--------------------------------------------------------- */
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   ⭐ Chat WebSocket Reliability System
   - Automatic reconnection
   - Message queue
   - waitForChatWSReady()
   - Heartbeat watchdog
--------------------------------------------------------- */

const chatQueue = [];

/**
 * Ensure Chat WebSocket stays connected
 */
function ensureChatWS() {
  const ws = sharedPopups.chatWS;

  // Already open → good
  if (ws && ws.readyState === WebSocket.OPEN) return;

  // Already connecting → let it finish
  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  console.warn("[Popups] Chat WS not connected — establishing…");

  /* ---------------------------------------------------------
     ⭐ Brave/iOS Fix #1 — Delay socket creation by 100ms
     Prevents Brave “Wait or Force Reload?”
  --------------------------------------------------------- */
  setTimeout(() => {
    sharedPopups.chatWS = new WebSocket(sharedPopups.chatWSURL);

    sharedPopups.chatWS.onopen = () => {
      console.log("[Popups] Chat WS connected");
      flushChatQueue();
    };

    sharedPopups.chatWS.onclose = () => {
      console.warn("[Popups] Chat WS closed — retrying soon");
      /* ---------------------------------------------------------
         ⭐ Brave/iOS Fix #2 — iOS safe-mode reconnect delay
      --------------------------------------------------------- */
      const delay = isIOS ? 1500 : 1000;
      setTimeout(ensureChatWS, delay);
    };

    sharedPopups.chatWS.onerror = () => {
      console.warn("[Popups] Chat WS error — restarting");
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
      console.error("[Popups] Failed to send queued message:", err);
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

  // If WS not ready → queue + wait
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[Popups] Chat WS not ready — queueing message");
    chatQueue.push(payload);
    await waitForChatWSReady();
  }

  // Try sending
  try {
    sharedPopups.chatWS.send(JSON.stringify(payload));
  } catch (err) {
    console.error("[Popups] Send failed — requeueing:", err);
    chatQueue.push(payload);
  }
}

/* ---------------------------------------------------------
   ⭐ Heartbeat watchdog — keeps WS alive forever
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
      console.warn("[Popups] Failed to fetch Velora access token:", res.status);
      return sharedPopups.veloraAccessToken;
    }

    const json = await res.json();
    const token = json.access_token || null;

    if (!token) {
      console.warn("[Popups] No access_token in /api/velora/access-token response");
      return sharedPopups.veloraAccessToken;
    }

    sharedPopups.veloraAccessToken = token;
    console.log("[Popups] Velora access token loaded for Events API");
    return sharedPopups.veloraAccessToken;
  } catch (err) {
    console.error("[Popups] Error loading Velora access token:", err);
    return sharedPopups.veloraAccessToken;
  }
}

export default sharedPopups;
