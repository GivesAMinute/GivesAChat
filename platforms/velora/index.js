import { initVeloraTokens } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

export function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  initVeloraTokens();

  if (!channelId) {
    console.error("[VELORA] Missing channelId");
    return;
  }

  startVeloraChatSocket({
    channelId,
    onMessage: (msg) => broadcast(msg)
  });

  startVeloraEventsSocket({
    onMessage: (msg) => broadcast(msg)
  });

  console.log("[VELORA] Platform started");
}
