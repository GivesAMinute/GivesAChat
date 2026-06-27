// platforms/velora/index.js
import { initVeloraTokens } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

export function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  // Load tokens from env
  initVeloraTokens();

  if (!channelId) {
    console.error("[VELORA] Missing channelId");
    return;
  }

  // ⭐ Start CHAT socket
  startVeloraChatSocket({
    channelId,
    onMessage: (msg) => broadcast(msg)
  });

  // ⭐ Start EVENTS socket
  startVeloraEventsSocket({
    onMessage: (msg) => broadcast(msg)
  });

  console.log("[VELORA] Platform started");
}
