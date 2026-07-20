// public/overlay/shared/_sharedPopups.js

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

  sharedPopups.chatWS = new WebSocket(sharedPopups.chatWSURL);

  sharedPopups.chatWS.onopen = () => {
    console.log("[Popups] Chat WS connected");
    flushChatQueue();
  };

  sharedPopups.chatWS.onclose = () => {
    console.warn("[Popups] Chat WS closed — retrying soon");
    setTimeout(ensureChatWS, 1000);
  };

  sharedPopups.chatWS.onerror = () => {
    console.warn("[Popups] Chat WS error — restarting");
    try { sharedPopups.chatWS.close(); } catch {}
  };
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
   ⭐ Initial connect
--------------------------------------------------------- */
ensureChatWS();

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
