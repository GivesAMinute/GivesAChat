// public/overlay/chat/main.js

import { scaleOverlay } from "./modules/scale.js";
import { isIOSDevice, createAudioUnlockButtons, unlockAudioOnly } from "./modules/audio.js";
import { showVoiceSelector } from "./modules/tts.js";
import { fetchRewardSounds } from "./modules/rewardSounds.js";
import { setupSocket } from "./modules/websocket.js";

// ⭐ Blaze chat (own Socket.IO connection — see modules/blaze.js)
import { setupBlazeChat } from "./modules/blaze.js";

// ⭐ Load date into header (OBS-only)
import { loadCurrentDate } from "./modules/currentDate.js";

// ⭐ Viewer count + header initializer
import { setupHeader } from "./modules/header.js";

// ⭐ Header on/off via ?header=no
import { showHeader } from "./modules/chatMode.js";

async function initOverlay() {
  /* ---------------------------------------------------------
     ⭐ Header toggle — applied before anything paints so the
     lane never renders at the wrong height and then jumps.
  --------------------------------------------------------- */
  const headerOn = showHeader();
  if (!headerOn) document.body.classList.add("header-off");

  // ⭐ Audio unlock
  if (isIOSDevice()) {
    createAudioUnlockButtons(showVoiceSelector);
  } else {
    unlockAudioOnly();
  }

  /* ---------------------------------------------------------
     ⭐ Brave/iOS Fix #1 — Delay heavy initializers
     Prevents Brave “Wait or Force Reload?” and iOS stalls.
  --------------------------------------------------------- */
  setTimeout(async () => {
    // ⭐ Load reward sounds (heavy)
    await fetchRewardSounds();

    /* ---------------------------------------------------------
       ⭐ Brave/iOS Fix #2 — Delay WebSocket startup
       Matches the delay inside websocket.js
    --------------------------------------------------------- */
    setupSocket();   // ⭐ Velora + Beam, via the worker

    // ⭐ Blaze connects directly: Socket.IO cannot run in workerd
    setupBlazeChat();

    /* ---------------------------------------------------------
       ⭐ Header systems — date, viewer count.

       Skipped entirely when the header is off. setupHeader()
       polls /api/viewers on a timer, so this isn't just
       cosmetic: a headerless source would otherwise keep
       requesting a viewer count nothing displays.
    --------------------------------------------------------- */
    if (headerOn) {
      loadCurrentDate();
      setupHeader();
    }

    /* ---------------------------------------------------------
       ❌ Beamstream removed
       (iframe scraper & imports fully removed)
    --------------------------------------------------------- */

  }, 120); // 100–150ms is the sweet spot for Brave/iOS
}

document.addEventListener("DOMContentLoaded", () => {
  scaleOverlay();
  initOverlay();
});
