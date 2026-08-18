// public/overlay/chat/modules/header.js

import { fetchViewerCount } from "./viewerCount.js";

/* ---------------------------------------------------------
   Viewer count refresh

   Was 5 seconds, which is 17,280 requests a day per open
   overlay — through the worker and on into Beamstream's API —
   to update a number that moves maybe once a minute.

   30s is indistinguishable on stream and cuts that to 2,880.
   Leave an overlay open all day and it's the difference
   between hammering someone else's API and not.
--------------------------------------------------------- */
const VIEWER_POLL_MS = 30000;

export function setupHeader() {
  // Straight away, so the header isn't blank for 30s.
  fetchViewerCount();

  setInterval(fetchViewerCount, VIEWER_POLL_MS);
}
