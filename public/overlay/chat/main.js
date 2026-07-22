// public/overlay/chat/main.js

import { scaleOverlay } from "./modules/scale.js";
import { isIOSDevice, createAudioUnlockButtons, unlockAudioOnly } from "./modules/audio.js";
import { showVoiceSelector } from "./modules/tts.js";
import { fetchRewardSounds } from "./modules/rewardSounds.js";
import { setupSocket } from "./modules/websocket.js";

// ⭐ Load date into header (OBS-only)
import { loadCurrentDate } from "./modules/currentDate.js";

// ⭐ NEW — Viewer count + header initializer
import { setupHeader } from "./modules/header.js";

async function initOverlay() {
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
    setupSocket();

    /* ---------------------------------------------------------
       ⭐ Brave/iOS Fix #3 — Delay header date load
       Prevents layout thrash during initial paint.
    --------------------------------------------------------- */
    loadCurrentDate();

    /* ---------------------------------------------------------
       ⭐ NEW — Initialize viewer count + header systems
       Safe to run after date + socket initialization.
    --------------------------------------------------------- */
    setupHeader();

  }, 120); // 100–150ms is the sweet spot for Brave/iOS
}

document.addEventListener("DOMContentLoaded", () => {
  scaleOverlay();
  initOverlay();
});
