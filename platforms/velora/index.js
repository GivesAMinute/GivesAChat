// platforms/velora/index.js
import { getVeloraAccessToken } from "./veloraAuth.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

/**
 * Velora Platform Initialization
 *
 * - Ensures access token is available
 * - Starts Events API socket (chat + rewards + celebrations)
 * - Chat socket removed (Events API replaces it)
 */

export async function startVeloraPlatform({ channelId, onMessage }) {
  console.log("[VELORA] Initializing…");

  const accessToken = await getVeloraAccessToken();

  if (!accessToken) {
    console.error("[VELORA] Failed to obtain access token — Velora disabled");
    return;
  }

  console.log("[VELORA] Access token ready — starting Events API socket…");

  // ⭐ Unified Velora Events API socket
  // Provides: chat.message, channel points, subs, raids, volts, celebrations, stickers, etc.
  startVeloraEventsSocket({
    onMessage
  });

  console.log("[VELORA] Velora platform started");
}
