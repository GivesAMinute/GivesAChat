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
function unlockAudioOnly() {
  const unlockAudio = new Audio("/overlay/silent.mp3");
  unlockAudio.volume = 0.01;

  unlockAudio.play().then(() => {
    audioUnlocked = true;
  }).catch(() => {});
}

/* ---------------------------------------------------------
   ⭐ Create trusted audio pool (iPad/iOS requires this)
--------------------------------------------------------- */
function createTrustedAudioPool() {
  window.rewardAudioPool = [];
  rewardAudioPoolIndex = 0;

  for (let i = 0; i < 6; i++) {
    const a = new Audio();
    a.volume = 1.0;
    window.rewardAudioPool.push(a);
  }
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

    audioUnlocked = true;

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

    // ⭐ Create trusted audio pool INSIDE user gesture
    createTrustedAudioPool();

    // ⭐ Unlock TTS (Safari requires this warm-up)
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(" ");
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("[Audio] Immediate TTS unlock failed:", e);
    }

    unlockAudioOnly();
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

    // ⭐ Create trusted audio pool INSIDE user gesture
    createTrustedAudioPool();

    // ⭐ Unlock TTS
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(" ");
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("[Audio] Immediate TTS unlock failed:", e);
    }

    unlockAudioOnly();
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
