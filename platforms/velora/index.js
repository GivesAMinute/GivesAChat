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

  const refreshToken = loadRefreshToken();
  if (!refreshToken) {
    console.log("[VELORA] No refresh token available at startup");
    return { chat: null, events: null };
  }

  let accessToken = loadAccessToken();

  if (!accessToken) {
    console.log("[VELORA] No access token found, refreshing once…");

    accessToken = await refreshVeloraToken(refreshToken);

    if (!accessToken) {
      console.log("[VELORA] Refresh failed, cannot connect.");
      return { chat: null, events: null };
    }

    saveAccessToken(accessToken);
  }

  try {
    await loadVeloraEmotes(channelId);
  } catch (err) {
    console.error("[VELORA] Failed to load emotes:", err);
  }

  // ⭐ Chat socket transforms internally
  const chat = startVeloraChatSocket({
    channelId,
    accessToken,
    onMessage: (msg) => broadcast(msg)
  });

  // ⭐ Events socket transforms internally (FIXED)
  const events = startVeloraEventsSocket({
    accessToken,
    onMessage: (msg) => broadcast(msg)
  });

  console.log("[VELORA] Platform started");

  return { chat, events };
}
