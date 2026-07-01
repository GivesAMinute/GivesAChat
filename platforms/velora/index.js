// platforms/velora/index.js
import { loadRefreshToken, loadAccessToken, saveAccessToken } from "./veloraTokenStore.js";
import { refreshVeloraToken } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";

export async function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  // 1. Load refresh token (ENV only)
  const refreshToken = loadRefreshToken();
  if (!refreshToken) {
    console.log("[VELORA] No refresh token available at startup");
    return;
  }

  // 2. Try loading an existing access token first
  let accessToken = loadAccessToken();

  // 3. If no access token exists, THEN refresh once
  if (!accessToken) {
    console.log("[VELORA] No access token found, refreshing once…");
    accessToken = await refreshVeloraToken(refreshToken);

    if (!accessToken) {
      console.log("[VELORA] Refresh failed, cannot connect.");
      return;
    }

    // Save new access token so next restart does NOT refresh again
    saveAccessToken(accessToken);
  }

  // 4. Start Velora chat socket
  startVeloraChatSocket({
    channelId,
    accessToken,
    onMessage: (msg) => broadcast(msg)
  });

  console.log("[VELORA] Platform started");
}
