// modules/rewardSounds.js

import { audioUnlocked } from "./audio.js";

const rewardSounds = new Map();
const CHANNEL_ID = "4f1cb975-eace-4650-8246-053007bd0036";

/* ---------------------------------------------------------
   ⭐ Fetch reward sound URLs from Velora
--------------------------------------------------------- */
/* ---------------------------------------------------------
   NEVER let this reject.

   This is a call to a third party we don't control, and it used
   to be the first await in the overlay's startup chain. When
   Velora was slow, down, or answered with an HTML error page,
   res.json() threw — and because the caller awaited it before
   doing anything else, the rejection took the WebSocket, the
   date, the header and Blaze down with it.

   The symptom was baffling in exactly the wrong way: a chat
   overlay with no chat and no clock, no error on screen, and
   nothing wrong with our own worker.

   Reward sounds are a nice-to-have. Losing them should cost us
   reward sounds and nothing else, so every failure path here
   ends in a warning and a return.
--------------------------------------------------------- */
async function fetchRewardSounds() {
  const url = `https://api.velora.tv/api/channel-points/${CHANNEL_ID}/items/with-built-in`;

  try {
    /* Bounded, so a hanging connection can't stall startup
       either — a request that never settles is just as bad as
       one that throws. */
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      console.warn(`[RewardSounds] Velora returned ${res.status} — no sounds loaded`);
      return;
    }

    const data = await res.json();

    if (!data?.items) {
      console.warn("[RewardSounds] unexpected response shape — no sounds loaded");
      return;
    }

    data.items.forEach((item) => {
      if (item.alertSoundUrl) rewardSounds.set(item.id, item.alertSoundUrl);
    });

    console.log(`[RewardSounds] loaded ${rewardSounds.size} sounds`);
  } catch (err) {
    console.warn("[RewardSounds] could not load sounds:", err?.message || err);
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
