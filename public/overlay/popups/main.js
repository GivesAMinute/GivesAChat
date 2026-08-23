// public/overlay/popups/main.js

import _sharedPopups from "/overlay/shared/_sharedPopups.js";
import { scaleOverlay } from "/overlay/chat/modules/scale.js";

// ⭐ Unified initializer (DO WebSocket + Velora Events API)
import { setupPopupSocket } from "/overlay/popups/modules/websocketPopups.js";

// ⭐ ?opacity=none — see overlayTransparency.js
import { applyTransparency } from "/overlay/shared/overlayTransparency.js";

document.addEventListener("DOMContentLoaded", () => {
  // ⭐ CRITICAL: scale the popups overlay just like chat overlay
  // Without this, the popup renders off‑screen on non‑1920×1080 canvases
  scaleOverlay();

  /* This overlay already declares `background: transparent`, so
     ?opacity=none changes nothing here today. It is wired up
     anyway: the flag should mean the same thing on both sources,
     and if a background is ever added to this page it should not
     quietly break GoLightStream again. */
  applyTransparency();

  /* ---------------------------------------------------------
     ⭐ Brave/iOS Fix — Delay WebSocket startup
     Prevents Brave stalls and iOS reload loops.
  --------------------------------------------------------- */
  setTimeout(() => {
    // ⭐ Initialize BOTH pipelines:
    // - DO WebSocket (existing)
    // - Velora Events API (new)
    setupPopupSocket();
  }, 120); // 100–150ms is the sweet spot for Brave/iOS
});
