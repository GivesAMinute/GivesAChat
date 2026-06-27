// platforms/blaze/index.js
import { BlazePoller } from "./blazePoller.js";
import { startBlazeEventSub } from "./blazeEventSub.js";
import { refreshBlazeToken } from "./blazeAuth.js";

export async function startBlaze(broadcast) {
  const channelId = process.env.BLAZE_CHANNEL_ID;
  const clientId = process.env.BLAZE_CLIENT_ID;

  console.log("[BLAZE] Initializing Blaze…");

  // ⭐ Ensure we have a valid token BEFORE anything starts
  await refreshBlazeToken();

  // ⭐ Start EventSub first
  startBlazeEventSub(broadcast);

  // ⭐ Start poller (no accessToken param anymore)
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
