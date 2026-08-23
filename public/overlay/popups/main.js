// public/overlay/popups/main.js

/* ---------------------------------------------------------
   DO NOT put ?v= on these imports.

   It was tried, to defeat a stale cached module, and it broke
   audio completely on every URL.

   A module's identity is its URL. Importing the same file as
   "./modules/rewardSounds.js?v=27" here and as
   "./rewardSounds.js" from rewardRenderer.js loads it TWICE —
   two separate instances, each with its own state. So
   fetchRewardSounds() filled the sound map in one copy while
   playRewardSound() read an empty map in the other, and
   unlockAudioOnly() set audioUnlocked in one instance while
   rewardSounds.js checked it in another.

   Cache freshness is handled properly by public/_headers,
   which sets no-cache, must-revalidate on /overlay/*. If a
   stale module is ever suspected again, fix it there — never
   by making one importer's URL differ from another's.
--------------------------------------------------------- */

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
