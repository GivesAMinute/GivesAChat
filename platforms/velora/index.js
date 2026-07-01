// platforms/velora/index.js
import { getVeloraAccessToken } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

/**
 * Velora Platform Initialization
 *
 * - Fetches access token using Client Credentials OAuth
 * - Starts chat + events sockets
 */

export async function startVeloraPlatform({ channelId, onMessage }) {
  console.log("[VELORA] Initializing…");

  // Fetch access token
  const accessToken = await getVeloraAccessToken();

  if (!accessToken) {
    console.error("[VELORA] Failed to obtain access token — Velora disabled");
    return;
  }

  console.log("[VELORA] Access token ready — starting sockets…");

  // Start chat socket
  startVeloraChatSocket({
    channelId,
    onMessage
  });

  // Start events socket
  startVeloraEventsSocket({
    onEvent: onMessage
  });

  console.log("[VELORA] Velora platform started");
}
