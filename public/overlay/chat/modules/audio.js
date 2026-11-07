// modules/audio.js

let audioUnlocked = false;

// ⭐ Detect OBS browser source (OBS always includes "OBS" in UA)
window.obsBrowserSource = navigator.userAgent.includes("OBS");

// ⭐ Global flag controlling chat TTS (Velora alerts always speak)
window.enableChatTTS = false;

// ⭐ Trusted audio pool for overlapping channel point sounds (iPad-safe)
window.rewardAudioPool = [];
let rewardAudioPoolIndex = 0;

// ⭐ Global tracking for audio priority
window.rewardAudioPlayingCount = window.rewardAudioPlayingCount || 0;
window.rewardSoundQueue = window.rewardSoundQueue || [];
window.ttsSpeaking = window.ttsSpeaking || false;
window.ttsPending = window.ttsPending || false;

function isIOSDevice() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

function styleUnlockButton(btn) {
  btn.style.padding = "30px 60px";
  btn.style.fontSize = "32px";
  btn.style.fontWeight = "700";
  btn.style.borderRadius = "20px";
  btn.style.border = "none";
  btn.style.cursor = "pointer";
  btn.style.background = "#ffcc00";
  btn.style.color = "#000";
  btn.style.boxShadow = "0 0 40px rgba(0,0,0,0.5)";
  btn.style.pointerEvents = "auto";
}

/* ---------------------------------------------------------
   ⭐ Unlock AUDIO ONLY (silent MP3)
--------------------------------------------------------- */
/* ---------------------------------------------------------
   ⭐ THE UNLOCK MUST NOT HANG ON ONE PROMISE.

   Captured on the iPad:

     [Audio] unlock FAILED: AbortError
     [RewardSounds] BAILED: not unlocked and not a compositor

   Every reward sound for the rest of the session, killed by one
   rejected promise.

   Two causes, both fixed here.

   The element was LOCAL. Once unlockAudioOnly() returned nothing
   referenced it, and Safari may collect an Audio element before
   its play() settles — which surfaces as AbortError. It is now
   held on window. Calling speechSynthesis.speak() immediately
   before, as the buttons do, makes the abort more likely by
   taking the audio session mid-start.

   And the flag meant the wrong thing. audioUnlocked gated ALL
   playback but recorded "a particular promise resolved". What it
   needs to record is "the user has tapped, so we are allowed to
   play" — which is true the instant the handler runs, because a
   tap IS the gesture. The silent MP3 is a warm-up, and a warm-up
   failing is not a reason to refuse audio for the rest of the
   stream.
--------------------------------------------------------- */
function markAudioUnlocked(why) {
  audioUnlocked = true;
  window.gacAudioUnlocked = true;
  console.log(`[Audio] unlocked (${why})`);
}

function unlockAudioOnly() {
  /* Held on window so it cannot be collected mid-play. */
  const unlockAudio = window.gacUnlockAudio || new Audio("/overlay/silent.mp3");
  window.gacUnlockAudio = unlockAudio;
  unlockAudio.volume = 0.01;

  /* Set BEFORE awaiting anything: we are inside a user gesture,
     which is the only thing iOS actually requires. */
  markAudioUnlocked("user gesture");

  unlockAudio.play().then(() => {
    console.log("[Audio] silent warm-up ok");
  }).catch((err) => {
    /* Logged, not fatal. The pool was primed in the same gesture
       and is what plays reward sounds. */
    console.warn(
      `[Audio] silent warm-up failed: ${err?.name || err} — continuing, pool was primed`
    );
  });
}

/* ---------------------------------------------------------
   ⭐ Create trusted audio pool (iPad/iOS requires this)
--------------------------------------------------------- */
/* ---------------------------------------------------------
   ⭐ PRIME THE POOL, NOT A THROWAWAY ELEMENT.

   These six elements are what actually play reward sounds, and
   they were only ever constructed here — never played. iOS wants
   each element started inside a user gesture before it will play
   unprompted later, so the element that got unlocked was the
   throwaway one in unlockAudioOnly() and the pool was not.

   Starting and immediately pausing each one, inside the tap,
   is what makes them usable afterwards.
--------------------------------------------------------- */
function createTrustedAudioPool() {
  window.rewardAudioPool = [];
  rewardAudioPoolIndex = 0;

  for (let i = 0; i < 6; i++) {
    const a = new Audio();
    a.volume = 1.0;

    /* Prime inside the gesture. Failures are expected and
       harmless on platforms that do not need this. */
    try {
      a.src = "/overlay/silent.mp3";
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
      }
    } catch { /* not every platform allows this; not fatal */ }

    window.rewardAudioPool.push(a);
  }

  console.log(`[Audio] pool primed (${window.rewardAudioPool.length} elements)`);
}

/* ---------------------------------------------------------
   ⭐ Create Unlock Buttons
--------------------------------------------------------- */
function createAudioUnlockButtons(showVoiceSelector) {

  /* ---------------------------------------------------------
     ⭐ OBS MODE — auto-unlock audio, skip UI, no TTS
  --------------------------------------------------------- */
  if (window.obsBrowserSource) {
    console.log("[Audio] OBS detected — auto-unlocking channel point audio");

    markAudioUnlocked("OBS");

    // Create trusted audio pool automatically
    createTrustedAudioPool();

    // OBS never uses TTS
    window.enableChatTTS = false;

    return; // Skip unlock UI entirely
  }

  /* ---------------------------------------------------------
     ⭐ NORMAL BROWSER MODE — show unlock UI
  --------------------------------------------------------- */
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "50%";
  wrapper.style.left = "50%";
  wrapper.style.transform = "translate(-50%, -50%)";
  wrapper.style.zIndex = "999999";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "20px";

  /* ---------------------------------------------------------
     ⭐ ENABLE CHANNEL POINTS AUDIO ONLY
  --------------------------------------------------------- */
  const btnAudio = document.createElement("button");
  btnAudio.textContent = "ENABLE CHANNEL POINTS AUDIO ONLY";
  styleUnlockButton(btnAudio);
  btnAudio.addEventListener("click", () => {

    window.enableChatTTS = false;

    /* ⭐ ORDER MATTERS — audio before speech.
       Starting speechSynthesis takes the audio session, and
       doing it between priming the pool and unlocking audio is
       what produced "unlock FAILED: AbortError" on the iPad.
       Audio first, speech warm-up last. */
    createTrustedAudioPool();
    unlockAudioOnly();

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(" ");
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("[Audio] Immediate TTS unlock failed:", e);
    }

    wrapper.remove();
  });

  /* ---------------------------------------------------------
     ⭐ ENABLE FULL TTS
  --------------------------------------------------------- */
  const btnAudioTTS = document.createElement("button");
  btnAudioTTS.textContent = "ENABLE FULL TTS";
  styleUnlockButton(btnAudioTTS);
  btnAudioTTS.addEventListener("click", () => {

    window.enableChatTTS = true;

    /* ⭐ Audio before speech — see the note on the button above. */
    createTrustedAudioPool();
    unlockAudioOnly();

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(" ");
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("[Audio] Immediate TTS unlock failed:", e);
    }

    showVoiceSelector();
    wrapper.remove();
  });

  wrapper.appendChild(btnAudio);
  wrapper.appendChild(btnAudioTTS);
  document.body.appendChild(wrapper);
}

export {
  isIOSDevice,
  unlockAudioOnly,
  createAudioUnlockButtons,
  audioUnlocked
};
