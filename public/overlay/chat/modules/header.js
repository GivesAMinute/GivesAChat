// public/overlay/chat/modules/header.js

import { fetchViewerCount } from "./viewerCount.js";

export function setupHeader() {
  // Initial fetch
  fetchViewerCount();

  // Update every 5 seconds
  setInterval(fetchViewerCount, 5000);
}
