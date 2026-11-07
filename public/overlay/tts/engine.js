import { drainRewardSoundQueue } from "../chat/modules/rewardSounds.js";

import { pronounce } from "./pronounce.js";
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

  /* ---------------------------------------------------------
     ⭐ Every spoken string in the overlay comes through here —
     chat, Velora alerts, claim cards, superchats — so the
     pronunciation pass lives at this one point rather than at
     each of the four places that build speech text.

     Nothing on screen is affected: this rewrites only what is
     handed to the engine. See tts/pronounce.js.
  --------------------------------------------------------- */
  const spoken = pronounce(text);

  ensureVoicesReady(() => {
    queue.push(spoken);

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

  /* ---------------------------------------------------------
     ⭐ onend AND onerror, because onend is not guaranteed.

     Channel point audio hangs off this handler: a reward
     redeemed while TTS is talking is queued by
     playRewardSound() and ONLY released by the drain below.

     That made a single missed event fatal. If an utterance
     errors — or is cancelled, or silently never completes,
     which Web Speech does on Safari and the iPad — then
     `speaking` stays true forever, every later message stops
     being spoken, and every queued channel point sound is
     stranded for the rest of the session.

     Which is exactly the reported symptom: sounds play with
     "Channel Points Only" (nothing is ever queued, because
     nothing is speaking) and not with "Full TTS".

     Same cleanup either way.
  --------------------------------------------------------- */
  const finish = (why) => {
    if (!speaking) return;              // already handled

    speaking = false;
    window.ttsSpeaking = false;

    if (why !== "end") {
      console.warn(`[TTS] utterance ended via ${why} — recovering`);
    }

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

  utter.onend = () => finish("end");
  utter.onerror = (e) => finish(e?.error || "error");

  speechSynthesis.speak(utter);
}

/* ---------------------------------------------------------
   ⭐ Preload voices (Safari requires this)
--------------------------------------------------------- */
export function preloadVoices() {
  speechSynthesis.getVoices();
}
