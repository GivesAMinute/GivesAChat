// public/overlay/popups/main.js

/* ---------------------------------------------------------
   EVERY IMPORT CARRIES ?v=9.

   Only this file's <script src> is version-busted by
   index.html. Its imports are plain paths, so a browser is free
   to pair a brand-new main.js with a cached copy of any module
   it imports.

   That is not theoretical — it is what broke GoLightStream:
   transparency worked because the cached module already did
   that, while the compositor flag it was meant to set did not
   exist in that copy. Audio stayed dead and no diagnostic
   arrived, with the deployed code looking perfectly correct.

   Worse, a cached module MISSING an export named here fails the
   whole graph and the overlay renders nothing.

   So bump this number with the one in index.html, together.
--------------------------------------------------------- */

import _sharedPopups from "/overlay/shared/_sharedPopups.js?v=10";
import { scaleOverlay } from "/overlay/chat/modules/scale.js?v=10";

// ⭐ Unified initializer (DO WebSocket + Velora Events API)
import { setupPopupSocket } from "/overlay/popups/modules/websocketPopups.js?v=10";

// ⭐ ?opacity=none — see overlayTransparency.js
import { applyTransparency } from "/overlay/shared/overlayTransparency.js?v=10";


document.addEventListener("DOMContentLoaded", () => {
  // ⭐ CRITICAL: scale the popups overlay just like chat overlay
  // Without this, the popup renders off‑screen on non‑1920×1080 canvases
  scaleOverlay();

  /* This overlay already declares `background: transparent`, so
     ?opacity=none changes nothing here today. It is wired up
     anyway: the flag should mean the same thing on both sources,
     and if a background is ever added to this page it should not
     quietly break GoLightStream again. */
  /* Flag set here rather than in the module — main.js is the
     only file whose URL carries a version, so an imported module
     can be served from cache. See the note in chat/main.js. */
  if (applyTransparency() === true) {
    window.gacCompositorMode = true;
  }

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
