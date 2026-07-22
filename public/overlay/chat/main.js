// public/overlay/chat/main.js

import { scaleOverlay } from "./modules/scale.js";
import { isIOSDevice, createAudioUnlockButtons, unlockAudioOnly } from "./modules/audio.js";
import { showVoiceSelector } from "./modules/tts.js";
import { fetchRewardSounds } from "./modules/rewardSounds.js";
import { setupSocket } from "./modules/websocket.js";

// ⭐ NEW — Load date into header
import { loadCurrentDate } from "./modules/currentDate.js";

async function initOverlay() {
  // ⭐ Audio unlock
  if (isIOSDevice()) {
    createAudioUnlockButtons(showVoiceSelector);
  } else {
    unlockAudioOnly();
  }

  // ⭐ Load reward sounds
  await fetchRewardSounds();

  // ⭐ Chat WebSocket
  setupSocket();

  // ⭐ Load header date (OBS-only header)
  loadCurrentDate();
}

document.addEventListener("DOMContentLoaded", () => {
  scaleOverlay();
  initOverlay();
});
