// platforms/velora/index.js
import { getVeloraAccessToken } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

/**
 * Velora Platform Initialization
 *
 * - Ensures access token is available (auth or refresh)
 * - Starts chat + events sockets
 */

export async function startVeloraPlatform({ channelId, onMessage }) {
  console.log("[VELORA] Initializing…");

  const accessToken = await getVeloraAccessToken();

  if (!accessToken) {
    console.error("[VELORA] Failed to obtain access token — Velora disabled");
    return;
  }

  console.log("[VELORA] Access token ready — starting sockets…");

  // Chat socket
  startVeloraChatSocket({
    channelId,
    onMessage
  });

  // Events socket
  startVeloraEventsSocket({
    onEvent: onMessage
  });

  console.log("[VELORA] Velora platform started");
}
