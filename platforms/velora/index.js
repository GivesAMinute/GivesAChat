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

import {
  transformVeloraChatMessage,
  transformVeloraEvent
} from "./veloraTransform.js"; // adjust path if needed

export async function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  // 1. Load refresh token (ENV only)
  const refreshToken = loadRefreshToken();
  if (!refreshToken) {
    console.log("[VELORA] No refresh token available at startup");
    return { chat: null, events: null };
  }

  // 2. Try loading an existing access token first
  let accessToken = loadAccessToken();

  // 3. If no access token exists, THEN refresh once
  if (!accessToken) {
    console.log("[VELORA] No access token found, refreshing once…");

    accessToken = await refreshVeloraToken(refreshToken);

    if (!accessToken) {
      console.log("[VELORA] Refresh failed, cannot connect.");
      return { chat: null, events: null };
    }

    // Save new access token so next restart does NOT refresh again
    saveAccessToken(accessToken);
  }

  // ⭐ 4. Load Velora emotes BEFORE starting sockets
  try {
    await loadVeloraEmotes(channelId);
  } catch (err) {
    console.error("[VELORA] Failed to load emotes:", err);
  }

  // 5. Start Velora Chat WebSocket (newMessage)
  const chat = startVeloraChatSocket({
    channelId,
    accessToken,
    onMessage: (rawMsg) => {
      const msg = transformVeloraChatMessage(rawMsg);
      if (msg) broadcast(msg);
    }
  });

  // 6. Start Velora Events API WebSocket (event: "chat.message", subs, follows, raids, etc.)
  const events = startVeloraEventsSocket({
    accessToken,
    onMessage: (rawEvent) => {
      // Expect shape: { event, payload }
      const msg = transformVeloraEvent(rawEvent.event, rawEvent.payload);
      if (msg) broadcast(msg);
    }
  });

  console.log("[VELORA] Platform started");

  // ⭐ RETURN SOCKETS (critical for graceful shutdown)
  return { chat, events };
}
