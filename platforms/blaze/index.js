// platforms/blaze/index.js
import { BlazePoller } from "./blazePoller.js";
import { startBlazeEventSub } from "./blazeEventSub.js";
import { initBlazeTokens } from "./blazeAuth.js";

export async function startBlaze(broadcast) {
  const channelId = process.env.BLAZE_CHANNEL_ID;
  const clientId = process.env.BLAZE_CLIENT_ID;

  console.log("[BLAZE] Initializing Blaze…");

  // Load tokens from disk/env once
  initBlazeTokens();

  // Start EventSub first (doesn't depend on refresh)
  startBlazeEventSub(broadcast);

  const poller = new BlazePoller({
    channelId,
    clientId,
    intervalMs: 1000,
    onMessages: (messages) => {
      for (const msg of messages) {
        broadcast(msg);
      }
    }
  });

  poller.start();
}
