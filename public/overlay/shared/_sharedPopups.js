/* ---------------------------------------------------------
   ⭐ Shared Popups State (NO chat WebSocket)
--------------------------------------------------------- */
const sharedPopups = {
  // Cloudflare popup WebSocket endpoint
  wsURL: `${location.origin.replace("http", "ws")}/ws/popups`,

  // Velora access token (loaded at runtime)
  veloraAccessToken: null,

  // WebSocket reference (popups only)
  ws: null
};

/* ---------------------------------------------------------
   ⭐ Detect iOS (Safari WebKit)
--------------------------------------------------------- */
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------------------------------------------------------
   ⭐ NO Chat WebSocket
   Popup overlay must NOT connect to /ws/chat.
   Popup overlay must NOT forward chat events.
   Popup overlay must NOT maintain a second chat client.
--------------------------------------------------------- */

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
