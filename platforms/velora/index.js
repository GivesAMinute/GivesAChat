// platforms/velora/index.js
import {
  loadRefreshToken,
  loadAccessToken,
  saveAccessToken
} from "./veloraTokenStore.js";

import { refreshVeloraToken } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";
import { loadVeloraEmotes } from "./veloraEmotes.js";

export async function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  // ---------------------------------------------------------
  // 1️⃣ Load refresh token (ENV only)
  // ---------------------------------------------------------
  const refreshToken = loadRefreshToken();
  if (!refreshToken) {
    console.log("[VELORA] No refresh token available at startup");
    return { chat: null, events: null };
  }

  // ---------------------------------------------------------
  // 2️⃣ Load existing access token (cached)
  // ---------------------------------------------------------
  let accessToken = loadAccessToken();

  // ---------------------------------------------------------
  // 3️⃣ If no access token exists, refresh once
  // ---------------------------------------------------------
  if (!accessToken) {
    console.log("[VELORA] No access token found, refreshing once…");

    try {
      accessToken = await refreshVeloraToken(refreshToken);
    } catch (err) {
      console.error("[VELORA] Access token refresh threw:", err);
      return { chat: null, events: null };
    }

    if (!accessToken) {
      console.log("[VELORA] Refresh failed, cannot connect.");
      return { chat: null, events: null };
    }

    saveAccessToken(accessToken);
  }

  // ---------------------------------------------------------
  // 4️⃣ Load emotes BEFORE sockets start
  // ---------------------------------------------------------
  try {
    console.log("[VELORA] Loading emotes…");
    await loadVeloraEmotes(channelId);
    console.log("[VELORA] Emotes loaded");
  } catch (err) {
    console.error("[VELORA] Failed to load emotes:", err);
  }

  // ---------------------------------------------------------
  // 5️⃣ Start Velora Chat WebSocket
  // ---------------------------------------------------------
  console.log("[VELORA] Starting chat socket…");
  const chat = startVeloraChatSocket({
    channelId,
    accessToken,
    onMessage: (msg) => {
      try {
        broadcast(msg);
      } catch (err) {
        console.error("[VELORA] Chat broadcast error:", err);
      }
    }
  });

  // ---------------------------------------------------------
  // 6️⃣ Start Velora Events WebSocket
  // ---------------------------------------------------------
  console.log("[VELORA] Starting events socket…");
  const events = startVeloraEventsSocket({
    accessToken,
    onMessage: (msg) => {
      try {
        broadcast(msg);
      } catch (err) {
        console.error("[VELORA] Events broadcast error:", err);
      }
    }
  });

  // ---------------------------------------------------------
  // 7️⃣ Final confirmation
  // ---------------------------------------------------------
  console.log("[VELORA] Platform started");

  return { chat, events };
}
