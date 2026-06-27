import { initVeloraTokens } from "./veloraAuth.js";
import { startVeloraChatSocket } from "./veloraChatSocket.js";

export function startVeloraPlatform({ channelId, broadcast }) {
  console.log("[VELORA] Initializing…");

  initVeloraTokens();

  startVeloraChatSocket({
    channelId,
    onMessage: (msg) => broadcast(msg)
  });

  console.log("[VELORA] Platform started");
}
