import { initVeloraTokens } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

export function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  // ⭐ Load tokens from env ONLY — do NOT refresh here
  initVeloraTokens();

  if (!channelId) {
    console.error("[VELORA] Missing channelId");
    return;
  }

  // ⭐ Start chat socket
  startVeloraChatSocket({
    channelId,
    onMessage: (msg) => broadcast(msg)
  });

  // ⭐ Start events socket
  startVeloraEventsSocket({
    onMessage: (msg) => broadcast(msg)
  });

  console.log("[VELORA] Platform started");
}
