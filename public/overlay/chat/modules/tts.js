// modules/tts.js

import { speakText, setTTSVoice, preloadVoices } from "../../tts/engine.js";

/* ---------------------------------------------------------
   ⭐ THE VOICES THAT MAY APPEAR, BY NAME.

   An allowlist, not a filter. The picker used to be
   "everything the device reports, minus a long banned list",
   which is at the mercy of what iOS decides to expose — and
   speechSynthesis.getVoices() genuinely returns different
   results depending on when it is called and which voice packs
   have finished loading. That is how a second Daniel appeared
   without any change to the filtering.

   Naming the three wanted voices makes the picker deterministic:
   the same three buttons every time, in this order, regardless
   of what the OS lists or when.

   To add one, put its exact name here. bannedVoices below is
   kept only for the fallback.
--------------------------------------------------------- */
const PREFERRED_VOICES = ["Karen", "Samantha", "Daniel"];

const bannedVoices = [
  "Bad News","Bahh","Bells","Boing","Bubbles","Cellos","Wobble","Good News",
  "Jester","Organ","Trinoids","Whisper","Superstar","Piya","Soumya","Moira",
  "Rishi","Amira","Amélie","Albert","Fred","Junior","Kathy","Ralph","Zarvox",
  "Alice","Alva","Anna","Carmit","Damayanti","Daria","Ellen","Ioana","Joana",
  "Kanya","Kyoko","Lana","Laura","Lekha","Lesya","Linh","Luciana","Majed",
  "Tünde","Meijia","Melina","Milena","Mónica","Montse","Nora","Paulina",
  "Sara","Satu","Sinji","Thomas","Tina","Xander","Yelda","Yuna","Zosia",
  "Zuzana","Vani","Geeta","Tingting","Tessa"
];

function showVoiceSelector() {
  preloadVoices();

  const voices = speechSynthesis.getVoices();

  /* ---------------------------------------------------------
     ⭐ EXACTLY THE ALLOWLISTED VOICES, ONCE EACH.

     One button per NAME, because iOS ships the same voice more
     than once — a compact build and an enhanced one, both called
     "Samantha". The duplicate was not merely untidy, it was
     inert: selection is stored and resolved by name,

       utter.voice = voices.find(v => v.name === selectedVoice)

     so the second button always set the same voice as the first.

     find() takes the first match per name, which is the dedupe
     and the ordering in one step — buttons come out in
     PREFERRED_VOICES order rather than whatever order the OS
     happened to report.
  --------------------------------------------------------- */
  let filtered = PREFERRED_VOICES
    .map((name) => voices.find((v) => v.name === name))
    .filter(Boolean);

  /* ---------------------------------------------------------
     Fallback: a device with none of them installed must not get
     an empty picker and no way to choose anything. Deduped the
     same way.
  --------------------------------------------------------- */
  if (!filtered.length && voices.length) {
    console.warn(
      "[TTS] none of the preferred voices are installed — showing all usable voices"
    );

    const seen = new Set();
    filtered = voices.filter((v) => {
      if (bannedVoices.includes(v.name) || seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    });
  }

  if (!filtered.length) {
    setTimeout(showVoiceSelector, 500);
    return;
  }

  /* Tapping "Enable Full TTS" twice, or a retry racing the first
     call, would otherwise append a second picker on top of the
     first — which looks exactly like duplicated voices. */
  document.getElementById("gac-voice-picker")?.remove();

  const wrapper = document.createElement("div");
  wrapper.id = "gac-voice-picker";
  wrapper.style.position = "fixed";
  wrapper.style.top = "60%";
  wrapper.style.left = "50%";
  wrapper.style.transform = "translate(-50%, -50%)";
  wrapper.style.zIndex = "999999";
  wrapper.style.background = "#222";
  wrapper.style.padding = "20px 30px";
  wrapper.style.borderRadius = "20px";
  wrapper.style.color = "white";
  wrapper.style.fontSize = "24px";
  wrapper.style.display = "grid";
  wrapper.style.gridTemplateColumns = "repeat(3, 1fr)";
  wrapper.style.gap = "20px";
  wrapper.style.maxHeight = "60vh";
  wrapper.style.overflowY = "auto";

  const title = document.createElement("div");
  title.textContent = "Select TTS Voice";
  title.style.fontWeight = "700";
  title.style.fontSize = "28px";
  title.style.marginBottom = "10px";
  title.style.gridColumn = "1 / -1";
  wrapper.appendChild(title);

  filtered.forEach(v => {
    const btn = document.createElement("button");
    btn.textContent = v.name;
    btn.style.padding = "20px";
    btn.style.fontSize = "22px";
    btn.style.borderRadius = "14px";
    btn.style.border = "none";
    btn.style.cursor = "pointer";
    btn.style.background = "#ffcc00";
    btn.style.color = "#000";

    btn.addEventListener("click", () => {
      setTTSVoice(v.name);
      wrapper.remove();
    });

    wrapper.appendChild(btn);
  });

  document.body.appendChild(wrapper);
}

export {
  showVoiceSelector,
  speakText,
  setTTSVoice,
  preloadVoices
};
