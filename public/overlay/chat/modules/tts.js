// modules/tts.js

import { speakText, setTTSVoice, preloadVoices } from "../../tts/engine.js";

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
     ⭐ ONE BUTTON PER NAME.

     iOS ships the same voice more than once — a compact build
     and an enhanced one, both called "Samantha" — so the picker
     showed it twice with no way to tell which was which.

     Deduped on name, keeping the first. Everything downstream
     already works by name:

       utter.voice = voices.find(v => v.name === selectedVoice)

     so a second entry could never have been selected anyway. The
     duplicate button was not just untidy, it was inert: tapping
     it set the same voice as the first one.
  --------------------------------------------------------- */
  const seenNames = new Set();

  const filtered = voices.filter((v) => {
    if (bannedVoices.includes(v.name)) return false;
    if (seenNames.has(v.name)) return false;

    seenNames.add(v.name);
    return true;
  });

  if (!filtered.length) {
    setTimeout(showVoiceSelector, 500);
    return;
  }

  const wrapper = document.createElement("div");
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
