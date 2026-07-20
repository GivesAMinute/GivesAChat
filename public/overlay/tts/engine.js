import { drainRewardSoundQueue } from "../chat/modules/rewardSounds.js";

let selectedVoice = null;
let queue = [];
let speaking = false;
let voicesReady = false;

/* ---------------------------------------------------------
   ⭐ Helper: check if channel point sounds are playing
--------------------------------------------------------- */
function channelPointsBusy() {
  return (window.rewardAudioPlayingCount || 0) > 0;
}

/* ---------------------------------------------------------
   ⭐ Wait for voices to load (iOS Safari requires this)
--------------------------------------------------------- */
function ensureVoicesReady(callback) {
  const voices = speechSynthesis.getVoices();

  if (voices.length > 0) {
    voicesReady = true;
    callback();
    return;
  }

  speechSynthesis.onvoiceschanged = () => {
    voicesReady = true;
    callback();
  };
}

/* ---------------------------------------------------------
   ⭐ Set the active TTS voice
--------------------------------------------------------- */
export function setTTSVoice(voiceName) {
  selectedVoice = voiceName;
  console.log("[TTS] Voice set to:", selectedVoice);

  const warmup = new SpeechSynthesisUtterance(" ");
  warmup.volume = 0.0;
  speechSynthesis.speak(warmup);

  setTimeout(() => {
    const voices = speechSynthesis.getVoices();
    console.log("[TTS] Voices after delay:", voices.length);

    if (!voices || voices.length === 0) {
      console.warn("[TTS] Voices still not ready, retrying...");
      setTimeout(() => {
        const retryVoices = speechSynthesis.getVoices();
        console.log("[TTS] Voices after retry:", retryVoices.length);
      }, 300);
    }
  }, 300);
}

/* ---------------------------------------------------------
   ⭐ Queue a message for TTS
--------------------------------------------------------- */
export function speakText(text) {
  if (!selectedVoice) {
    console.warn("[TTS] No voice selected, skipping speech");
    return;
  }

  ensureVoicesReady(() => {
    queue.push(text);

    // ⭐ TTS is pending (about to speak)
    window.ttsPending = true;

    processQueue();
  });
}

/* ---------------------------------------------------------
   ⭐ Process queue (no overlapping)
   ⭐ Wait while channel point sounds are playing
--------------------------------------------------------- */
function processQueue() {
  if (speaking) return;

  if (queue.length === 0) {
    window.ttsPending = false;
    return;
  }

  if (channelPointsBusy()) {
    setTimeout(processQueue, 150);
    return;
  }

  const text = queue.shift();
  speaking = true;
  window.ttsPending = false;
  window.ttsSpeaking = true;

  const utter = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();

  if (!voices || voices.length === 0) {
    console.warn("[TTS] Voices not ready, retrying...");
    queue.unshift(text);
    speaking = false;
    window.ttsSpeaking = false;
    window.ttsPending = true;
    setTimeout(processQueue, 200);
    return;
  }

  utter.voice = voices.find(v => v.name === selectedVoice) || voices[0];
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.volume = 1.0;

  if (speechSynthesis.paused) {
    speechSynthesis.resume();
  }

  utter.onend = () => {
    speaking = false;
    window.ttsSpeaking = false;

    // ⭐ If more TTS messages exist, honour them FIRST
    if (queue.length > 0) {
      window.ttsPending = true;
      processQueue();
      return;
    }

    // ⭐ No more TTS pending — clear flag and drain channel points
    window.ttsPending = false;
    drainRewardSoundQueue();
  };

  speechSynthesis.speak(utter);
}

/* ---------------------------------------------------------
   ⭐ Preload voices (Safari requires this)
--------------------------------------------------------- */
export function preloadVoices() {
  speechSynthesis.getVoices();
}
