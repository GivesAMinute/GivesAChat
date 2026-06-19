// backend/blaze/index.js
import { BlazePoller } from "./blazePoller.js";
import { startBlazeEventSub } from "./blazeEventSub.js";

export function startBlaze(broadcast) {
  const channelId = process.env.BLAZE_CHANNEL_ID;
  const clientId = process.env.BLAZE_CLIENT_ID;
  const accessToken = process.env.BLAZE_ACCESS_TOKEN;

  const poller = new BlazePoller({
    channelId,
    clientId,
    accessToken,
    intervalMs: 1000,
    onMessages: (messages) => {
      for (const msg of messages) {
        broadcast(msg);
      }
    }
  });

  poller.start();
  startBlazeEventSub(broadcast);
}
