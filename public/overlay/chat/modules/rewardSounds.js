// modules/rewardSounds.js

import { audioUnlocked } from "./audio.js";

const rewardSounds = new Map();

/* The channel id now lives in the worker (VELORA_CHANNEL_ID),
   since that is where the fetch happens. */

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
/* ---------------------------------------------------------
   FETCHED THROUGH OUR OWN WORKER, NOT FROM VELORA DIRECTLY.

   This used to call api.velora.tv straight from the browser.
   Velora removed their Access-Control-Allow-Origin header, so
   the browser began refusing the response:

     blocked by CORS policy: No 'Access-Control-Allow-Origin'
     header is present on the requested resource

   Every reward sound stopped playing everywhere at once — and
   because an empty map is indistinguishable from a redemption
   with no sound configured, it failed completely silently.

   CORS binds browsers, not servers. /api/velora/reward-sounds
   fetches the same data worker-side and serves it from our own
   origin, which also means a future change to their headers
   can't take our audio out again.
--------------------------------------------------------- */
async function fetchRewardSounds() {
  /* Same key the overlay was opened with — works for both the
     operator's OVERLAY_KEY and a viewer's VIEWER_KEY. */
  const key = new URLSearchParams(location.search).get("key") || "";
  const url = `/api/velora/reward-sounds?key=${encodeURIComponent(key)}`;

  try {
    /* ---------------------------------------------------------
       Bounded, so a hanging connection can't stall startup —
       a request that never settles is as bad as one that throws.

       BUT AbortSignal.timeout() IS NOT EVERYWHERE.

       It is recent, and on an older Chromium it is undefined, so
       calling it throws a TypeError BEFORE fetch is reached. The
       catch below then turns that into a console warning, and
       the result is no request, an empty sound map, and every
       reward sound dropped in total silence.

       That is exactly what happened in GoLightStream: chat,
       Blaze and the viewer count all worked, while
       /api/velora/reward-sounds never appeared in the logs at
       all — not failing, simply never sent.

       So the timeout is used when available and skipped when it
       is not. Losing the timeout on an old renderer is a far
       smaller problem than losing every sound.
    --------------------------------------------------------- */
    const options = {};

    if (typeof AbortSignal !== "undefined" &&
        typeof AbortSignal.timeout === "function") {
      options.signal = AbortSignal.timeout(8000);
    }

    const res = await fetch(url, options);

    if (!res.ok) {
      console.warn(`[RewardSounds] proxy returned ${res.status} — no sounds loaded`);
      return;
    }

    const data = await res.json();

    if (!Array.isArray(data?.sounds)) {
      console.warn("[RewardSounds] unexpected response shape — no sounds loaded");
      return;
    }

    data.sounds.forEach((s) => {
      if (s?.id && s.url) rewardSounds.set(s.id, s.url);
    });

    console.log(`[RewardSounds] loaded ${rewardSounds.size} sounds`);

    if (!rewardSounds.size && data.error) {
      console.warn("[RewardSounds] upstream said:", data.error);
    }
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
  /* ---------------------------------------------------------
     TEMPORARY DIAGNOSTIC — logging only, no behaviour change.

     There are three silent returns below and no way to tell
     which one fires, so "no sound" has three possible causes
     that look identical from the outside. Remove once the
     cause is known.
  --------------------------------------------------------- */
  if (!audioUnlocked) {
    console.warn("[RewardSounds] BAILED: audio not unlocked");
    return;
  }

  const url = rewardSounds.get(rewardId);
  if (!url) {
    console.warn(
      `[RewardSounds] BAILED: no sound for rewardId ${JSON.stringify(rewardId)}`,
      `— ${rewardSounds.size} sound(s) loaded, ids:`,
      [...rewardSounds.keys()].slice(0, 5)
    );
    return;
  }

  const pool = window.rewardAudioPool;
  if (!pool || pool.length === 0) {
    console.warn("[RewardSounds] BAILED: audio pool empty");
    return;
  }

  console.log(`[RewardSounds] playing ${rewardId}`);

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
  /* ---------------------------------------------------------
     ⭐ Compositors take the OBS path.

     window.gacCompositorMode is set ONLY by ?opacity=none — the
     URL used in GoLightStream and nowhere else. Without that
     flag this reduces to exactly the old `window.obsBrowserSource`
     check, so OBS, the iPad and the public pop-out are bit-for-bit
     unaffected.

     WHY IT IS NEEDED. The browser path below plays through a pool
     of six Audio elements that is only built in the OBS branch or
     on an iOS unlock tap. GoLightStream is neither, so the pool
     stayed empty and every sound was dropped before an Audio was
     even constructed.

     The popups overlay has no such gate — it does
     `new Audio(url).play()` per sound — and its audio works in
     GoLightStream. playRewardSoundImmediateOBS() is that same
     two-line approach, so this routes a compositor to the one
     mechanism with evidence behind it.
  --------------------------------------------------------- */
  const compositor = !!window.obsBrowserSource || !!window.gacCompositorMode;

  if (!audioUnlocked && !compositor) {
    console.warn("[RewardSounds] BAILED: not unlocked and not a compositor");
    return;
  }

  const url = rewardSounds.get(rewardId);
  if (!url) {
    console.warn(
      `[RewardSounds] BAILED: rewardId ${JSON.stringify(rewardId)} not in the map`
    );
    return;
  }

  /* ---------------------------------------------------------
     ⭐ OBS / COMPOSITOR MODE — play immediately, always overlap
  --------------------------------------------------------- */
  if (compositor) {
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
