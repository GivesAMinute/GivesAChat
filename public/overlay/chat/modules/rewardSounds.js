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
    /* Bounded, so a hanging connection can't stall startup
       either — a request that never settles is just as bad as
       one that throws. */
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

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
/* ---------------------------------------------------------
   TEMPORARY — report to the worker, for GoLightStream only.

   That renderer has no console we can open, so a playback
   failure there is invisible. In compositor mode only, each
   outcome is POSTed to /api/overlay-log and shows up in
   `wrangler tail`.

   Never awaited and never allowed to throw: a diagnostic must
   not be able to break the thing it is diagnosing.
--------------------------------------------------------- */
/* ---------------------------------------------------------
   WHERE is this page running?

   Two very different things produce an identical
   NotAllowedError:

     a Chrome tab you have not clicked yet
     a cross-origin iframe with no allow="autoplay"

   GoLightStream renders browser sources in an IFRAME — their
   developer guidelines are entirely about frame-ancestors — so
   this one flag separates "our overlay in your browser" from
   "our overlay inside Lightstream", and the two need completely
   different answers.
--------------------------------------------------------- */
function frameContext() {
  try {
    if (window.top === window.self) return "top-level (a normal tab)";

    const parents = location.ancestorOrigins
      ? Array.from(location.ancestorOrigins).join(",")
      : "(origins hidden)";

    return `IFRAME inside ${parents}`;
  } catch {
    /* Throwing on window.top is itself evidence: a cross-origin
       parent blocks the access. */
    return "IFRAME (cross-origin parent)";
  }
}

export function reportToWorker(line) {
  if (!window.gacCompositorMode) return;

  try {
    const key = new URLSearchParams(location.search).get("key") || "";

    fetch(`/api/overlay-log?key=${encodeURIComponent(key)}`, {
      method: "POST",
      body: `${line} | ctx=${frameContext()}`
    }).catch(() => {});
  } catch {}
}

function playRewardSoundImmediateOBS(rewardId) {
  const url = rewardSounds.get(rewardId);
  if (!url) return;

  try {
    const audio = new Audio(url);
    audio.volume = 1.0;

    /* canPlayType answers the codec question directly: "" means
       the browser will not even attempt this format. Every Velora
       reward sound is .ogg, and Ogg is exactly the format a
       WebKit-based renderer refuses. */
    const oggSupport = audio.canPlayType("audio/ogg") || "(no)";
    const mp3Support = audio.canPlayType("audio/mpeg") || "(no)";

    audio.play()
      .then(() =>
        reportToWorker(
          `audio OK | ${url.split("/").pop()} | ogg=${oggSupport} mp3=${mp3Support}`
        )
      )
      .catch((err) =>
        reportToWorker(
          `audio FAILED | ${err?.name || err} | ${url.split("/").pop()} | ` +
            `ogg=${oggSupport} mp3=${mp3Support} | ua=${navigator.userAgent.slice(0, 80)}`
        )
      );

    audio.addEventListener("error", () =>
      reportToWorker(
        `audio ELEMENT ERROR | code=${audio.error?.code} | ` +
          `${url.split("/").pop()} | ogg=${oggSupport}`
      )
    );
  } catch (err) {
    console.warn("[OBS] Failed to play reward sound:", err);
    reportToWorker(`audio THREW | ${err?.message || err}`);
  }
}

/* ---------------------------------------------------------
   ⭐ Public entry: channel point redemption
   ⭐ OBS MODE: always play immediately with new Audio()
   ⭐ BROWSER MODE: queue if TTS is speaking or pending
--------------------------------------------------------- */
function playRewardSound(rewardId) {
  // TEMPORARY DIAGNOSTIC — remove with the others below.
  console.log(
    `[RewardSounds] redemption ${JSON.stringify(rewardId)} |`,
    `unlocked=${audioUnlocked} obs=${!!window.obsBrowserSource}`,
    `loaded=${rewardSounds.size} pool=${window.rewardAudioPool?.length ?? 0}`
  );

  /* ?opacity=none marks a broadcast compositor — see
     overlayTransparency.js. Treated exactly like OBS below:
     no unlock needed, and no audio pool required. */
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
     ⭐ COMPOSITOR MODE — always play immediately, always overlap

     A fresh Audio() per sound, no pool, no unlock. This is the
     path the popups overlay effectively uses, and the one we
     have now confirmed works in GoLightStream.
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
