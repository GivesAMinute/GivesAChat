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
  const filtered = voices.filter(v => !bannedVoices.includes(v.name));

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
