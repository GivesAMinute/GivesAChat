// modules/rewardSounds.js

import { audioUnlocked } from "./audio.js";

const rewardSounds = new Map();
const CHANNEL_ID = "4f1cb975-eace-4650-8246-053007bd0036";

/* ---------------------------------------------------------
   ⭐ Fetch reward sound URLs from Velora
--------------------------------------------------------- */
async function fetchRewardSounds() {
  const url = `https://api.velora.tv/api/channel-points/${CHANNEL_ID}/items/with-built-in`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.items) {
    data.items.forEach(item => {
      if (item.alertSoundUrl) rewardSounds.set(item.id, item.alertSoundUrl);
    });
  }
}

/* ---------------------------------------------------------
   ⭐ Helper: play one reward sound using trusted pool
   ⭐ Browser only — OBS uses fresh Audio() instead
--------------------------------------------------------- */
let poolIndex = 0;

function playRewardSoundImmediateBrowser(rewardId) {
  if (!audioUnlocked) return;

  const url = rewardSounds.get(rewardId);
  if (!url) return;

  const pool = window.rewardAudioPool;
  if (!pool || pool.length === 0) return;

  const audio = pool[poolIndex];
  poolIndex = (poolIndex + 1) % pool.length;

  window.rewardAudioPlayingCount++;

  audio.onended = () => {
    window.rewardAudioPlayingCount = Math.max(0, window.rewardAudioPlayingCount - 1);
  };

  audio.src = url;
  audio.currentTime = 0;
  audio.play().catch(() => {
    window.rewardAudioPlayingCount = Math.max(0, window.rewardAudioPlayingCount - 1);
  });
}

/* ---------------------------------------------------------
   ⭐ OBS MODE — use fresh Audio() for guaranteed playback
--------------------------------------------------------- */
function playRewardSoundImmediateOBS(rewardId) {
  const url = rewardSounds.get(rewardId);
  if (!url) return;

  try {
    const audio = new Audio(url);
    audio.volume = 1.0;
    audio.play().catch(() => {});
  } catch (err) {
    console.warn("[OBS] Failed to play reward sound:", err);
  }
}

/* ---------------------------------------------------------
   ⭐ Public entry: channel point redemption
   ⭐ OBS MODE: always play immediately with new Audio()
   ⭐ BROWSER MODE: queue if TTS is speaking or pending
--------------------------------------------------------- */
function playRewardSound(rewardId) {
  if (!audioUnlocked && !window.obsBrowserSource) return;

  const url = rewardSounds.get(rewardId);
  if (!url) return;

  /* ---------------------------------------------------------
     ⭐ OBS MODE — always play immediately, always overlap
  --------------------------------------------------------- */
  if (window.obsBrowserSource) {
    playRewardSoundImmediateOBS(rewardId);
    return;
  }

  /* ---------------------------------------------------------
     ⭐ BROWSER MODE — queue if TTS is speaking or pending
  --------------------------------------------------------- */
  if (window.ttsSpeaking || window.ttsPending) {
    window.rewardSoundQueue.push(rewardId);
    return;
  }

  playRewardSoundImmediateBrowser(rewardId);
}

/* ---------------------------------------------------------
   ⭐ Drain queued redemptions AFTER all earlier TTS finish
--------------------------------------------------------- */
function drainRewardSoundQueue() {
  if (!audioUnlocked) return;

  // OBS never queues, but safe to clear
  if (window.obsBrowserSource) {
    window.rewardSoundQueue.length = 0;
    return;
  }

  while (window.rewardSoundQueue.length > 0) {
    const rewardId = window.rewardSoundQueue.shift();
    playRewardSoundImmediateBrowser(rewardId);
  }
}

export {
  rewardSounds,
  fetchRewardSounds,
  playRewardSound,
  drainRewardSoundQueue
};
