// public/overlay/chat/modules/chatRenderer.js

import { speakText } from "./tts.js";
import { renderBlazeBadges } from "../badges/blaze/index.js";
import { renderVeloraBadges } from "../badges/velora/index.js";
import { colorForUsername } from "../utils/usernameColors.js";

/* ---------------------------------------------------------
   Global Queue System (no overlapping audio/TTS)
--------------------------------------------------------- */
const messageQueue = [];
let queueRunning = false;

function enqueue(job) {
  messageQueue.push(job);
  if (!queueRunning) processQueue();
}

async function processQueue() {
  queueRunning = true;

  while (messageQueue.length > 0) {
    const job = messageQueue.shift();

    if (job.soundUrl && window.sharedRewardAudio) {
      try {
        window.sharedRewardAudio.pause();
        window.sharedRewardAudio.currentTime = 0;
        window.sharedRewardAudio.src = job.soundUrl;
        window.sharedRewardAudio.volume = 1.0;
        await window.sharedRewardAudio.play().catch(() => {});
      } catch (e) {}
    }

    if (job.delayMs) {
      await new Promise(res => setTimeout(res, job.delayMs));
    }

    if (job.ttsText) {
      try {
        await speakText(job.ttsText);
      } catch (e) {}
    }

    await new Promise(res => setTimeout(res, 150));
  }

  queueRunning = false;
}

/* ---------------------------------------------------------
   Detect iOS / iPadOS
--------------------------------------------------------- */
const isIOS = (() => {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
})();

function isEmoteOnlyMessage(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent.trim().length === 0 && div.querySelectorAll("img").length > 0;
}

function extractEmoteNames(html, username) {
  const div = document.createElement("div");
  div.innerHTML = html;

  div.querySelectorAll("img").forEach(img => {
    let name = img.alt || img.dataset.hover || "emote";
    name = name.trim();

    const lower = name.toLowerCase();
    const userLower = username.toLowerCase();

    if (lower.startsWith(userLower)) {
      name = name.substring(username.length).trim();
      name = name.replace(/^[:\-\_ ]+/, "");
    }

    if (!name) name = "emote";

    img.replaceWith(document.createTextNode(` ${name} `));
  });

  return div.textContent || div.innerText || "";
}

function formatEmoteList(str) {
  const parts = str.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return `${parts[0]} emote`;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]} emotes`;
  const last = parts.pop();
  return `${parts.join(", ")} and ${last} emotes`;
}

/* ---------------------------------------------------------
   Handle Chat Messages (queued)
--------------------------------------------------------- */
function handleChat(payload, container) {
  if (payload.platform === "youtube" && payload.username.startsWith("@")) {
    payload.username = payload.username.substring(1);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "chat-message effect-enter";

  const icon = document.createElement("img");
  icon.className = "platform-icon";
  icon.src = `/icons/${payload.platform}.png`;

  const avatar = payload.avatar
    ? `<img class="inline-avatar" src="${payload.avatar}">`
    : "";

  let badgesHTML = "";

  if (payload.platform === "blaze") {
    badgesHTML = renderBlazeBadges(payload);

  } else if (payload.platform === "velora") {
    badgesHTML = renderVeloraBadges(payload);

  } else if (payload.platform === "youtube") {
    const b = payload.badges || {};
    const icons = [];

    if (b.owner) {
      icons.push(`<img class="badge-icon" src="/badges/youtube/owner.png">`);
    }
    if (b.moderator) {
      icons.push(`<img class="badge-icon" src="/badges/youtube/moderator.png">`);
    }
    if (b.sponsor) {
      icons.push(`<img class="badge-icon" src="/badges/youtube/member.png">`);
    }

    badgesHTML = icons.join("");
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (payload.platform === "velora") {
    if (payload.effect && payload.effect.startsWith("glow_")) {
      const name = payload.effect.replace("glow_", "").toLowerCase();
      const glowMap = {
        crimson: "effect-glow-crimson",
        sunset: "effect-glow-sunset",
        golden: "effect-glow-golden",
        emerald: "effect-glow-emerald",
        azure: "effect-glow-azure",
        violet: "effect-glow-violet"
      };
      bubble.classList.add("effect-color-glow");
      if (glowMap[name]) bubble.classList.add(glowMap[name]);
    }

    if (payload.effect && payload.effect.startsWith("galaxy_")) {
      const suffix = payload.effect.replace("galaxy_", "").toLowerCase();
      bubble.classList.add("effect-galaxy", `effect-galaxy-${suffix}`);
    }

    if (payload.effect === "rainbow") {
      bubble.classList.add("effect-rainbow");
    }
  }

  bubble.innerHTML = `
    <div class="chat-message-content">
      <span class="velora-line">
        ${avatar}
        ${badgesHTML}
        <span class="username">${payload.username}</span>
      </span>
      <span class="text">${payload.html}</span>
    </div>
  `;

  if (payload.platform === "velora" && payload.effect === "gigantify") {
    bubble.classList.add("effect-gigantify");
    const textNode = bubble.querySelector(".text");
    if (textNode) textNode.classList.add("effect-gigantify");
  }

  wrapper.appendChild(icon);
  wrapper.appendChild(bubble);

  const usernameSpan = wrapper.querySelector(".username");
  if (usernameSpan) {
    usernameSpan.style.color = colorForUsername(payload.username, payload.platform);
  }

  container.appendChild(wrapper);

  const cleanMessage = extractEmoteNames(payload.html, payload.username);

  let ttsText = null;

  if (window.enableChatTTS) {
    if (isEmoteOnlyMessage(payload.html)) {
      const formatted = formatEmoteList(cleanMessage.trim());
      ttsText = `${payload.username} on ${payload.platform} sent the ${formatted}`;
    } else {
      ttsText = `${payload.username} on ${payload.platform} says: ${cleanMessage}`;
    }
  }

  enqueue({
    soundUrl: null,
    delayMs: 0,
    ttsText
  });

  setTimeout(() => {
    wrapper.classList.add("fade-out");
    setTimeout(() => wrapper.remove(), 800);
  }, 45000);
}

/* ---------------------------------------------------------
   Velora System Alert (queued)
--------------------------------------------------------- */
function renderVeloraSystemMessage(event, data, container) {
  if (!container) return;
  if (event !== "channel.stream_alert") return;

  let text = "";

  if (data.alertType === "follow") {
    text = `${data.displayName || data.username} just followed!`;
  }
  else if (data.alertType === "subscribe") {
    text = `${data.displayName || data.username} subscribed at Tier 1!`;
  }
  else if (data.alertType === "gift") {
    text = `${data.displayName || data.username} gifted ${data.count || ""} sub(s)!`;
  }
  else if (data.alertType === "raid") {
    text = `${data.displayName || data.username} raided with ${data.viewers || ""} viewers!`;
  }
  else if (data.alertType === "volts") {
    text = `${data.displayName || data.username} sent volts!`;
  }
  else {
    text = data.message || `${data.displayName || data.username}`;
  }

  const wrapper = document.createElement("div");
  wrapper.className = `chat-message effect-enter velora-system-message velora-theme-volts`;

  const icon = document.createElement("img");
  icon.className = "platform-icon";
  icon.src = "/icons/velora.png";

  const bubble = document.createElement("div");
  bubble.className = "bubble velora-system-bubble";

  bubble.innerHTML = `
    <div class="chat-message-content velora-system-header">
      <img class="velora-system-logo" src="/icons/velora-horizontal.png">
      <span class="velora-system-title">Stream Alert:</span>
    </div>

    <div class="chat-message-content">
      <span class="text velora-system-text">${text}</span>
    </div>
  `;

  wrapper.appendChild(icon);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);

  let delayMs = 4500;

  if (data.customSoundUrl) {
    const tempAudio = new Audio();
    tempAudio.src = data.customSoundUrl;

    tempAudio.addEventListener("loadedmetadata", () => {
      if (!isNaN(tempAudio.duration) && tempAudio.duration > 0) {
        delayMs = Math.ceil(tempAudio.duration * 1000) + 500;
      }

      enqueue({
        soundUrl: data.customSoundUrl,
        delayMs,
        ttsText: `Velora Stream Alert. ${text}`
      });
    });
  } else {
    enqueue({
      soundUrl: null,
      delayMs: 0,
      ttsText: `Velora Stream Alert. ${text}`
    });
  }

  setTimeout(() => {
    wrapper.classList.add("fade-out");
    setTimeout(() => wrapper.remove(), 800);
  }, 45000);
}

export {
  handleChat,
  isEmoteOnlyMessage,
  extractEmoteNames,
  formatEmoteList,
  renderVeloraSystemMessage
};
