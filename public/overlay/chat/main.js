// public/overlay/chat/main.js

import { scaleOverlay } from "./modules/scale.js";
import { isIOSDevice, createAudioUnlockButtons, unlockAudioOnly } from "./modules/audio.js";
import { showVoiceSelector } from "./modules/tts.js";
import { fetchRewardSounds } from "./modules/rewardSounds.js";
import { setupSocket } from "./modules/websocket.js";

// ❌ Header system removed
// import { setupHeader } from "./modules/header.js";

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

  // ❌ Removed: setupHeader()
  // We are rebuilding the header from scratch.
}

document.addEventListener("DOMContentLoaded", () => {
  scaleOverlay();
  initOverlay();
});
