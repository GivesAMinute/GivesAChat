// platforms/velora/index.js
import { loadRefreshToken } from "./veloraTokenStore.js";
import { refreshVeloraToken } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";

export async function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  // 1. Load refresh token (file first, env fallback)
  let refreshToken = loadRefreshToken();

  if (!refreshToken) {
    console.log("[VELORA] No refresh token available at startup");
    return;
  }

  // 2. Refresh BEFORE connecting socket
  const accessToken = await refreshVeloraToken(refreshToken);

  if (!accessToken) {
    console.log("[VELORA] No token available, cannot connect.");
    return;
  }

  // 3. Start Velora chat socket
  startVeloraChatSocket({
    channelId,
    accessToken,
    onMessage: (msg) => broadcast(msg)
  });

  console.log("[VELORA] Platform started");
}
