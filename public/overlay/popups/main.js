// public/overlay/popups/main.js

import _sharedPopups from "/overlay/shared/_sharedPopups.js";
import { scaleOverlay } from "/overlay/chat/modules/scale.js";

// ⭐ Unified initializer (DO WebSocket + Velora Events API)
import { setupPopupSocket } from "/overlay/popups/modules/websocketPopups.js";

document.addEventListener("DOMContentLoaded", () => {
  // ⭐ CRITICAL: scale the popups overlay just like chat overlay
  // Without this, the popup renders off‑screen on non‑1920×1080 canvases
  scaleOverlay();

  // ⭐ Initialize BOTH pipelines:
  // - DO WebSocket (existing)
  // - Velora Events API (new)
  setupPopupSocket();
});
