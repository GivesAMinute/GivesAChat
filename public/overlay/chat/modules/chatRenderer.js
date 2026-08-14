import { speakText } from "./tts.js";
import { renderBlazeBadges } from "../badges/blaze/index.js";
import { renderVeloraBadges } from "../badges/velora/index.js";
import { renderYouTubeBadges } from "../badges/youtube/index.js";
import { renderBeamBadges } from "../badges/beam/index.js";   // ⭐ ADDED
import { colorForUsername } from "../utils/usernameColors.js";

/* ---------------------------------------------------------
   ⭐ YouTube Normalizer
--------------------------------------------------------- */
function normalizeYouTubePayload(payload) {
  let username = payload.username || "";
  if (username.startsWith("@")) {
    username = username.substring(1);
  }

  const avatar =
    payload.avatar ||
    payload.authorPhoto ||
    payload.profileImageUrl ||
    null;

  return {
    ...payload,
    username,
    avatar,
    platform: "youtube"
  };
}

/* ---------------------------------------------------------
   Queue System
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
   Emote Helpers
--------------------------------------------------------- */
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
   ⭐ EFFECT HANDLING + PLATFORM NORMALIZATION
--------------------------------------------------------- */
function handleChat(payload, container) {
  console.log("[OVERLAY] incoming chat payload:", payload);

  // Normalize YouTube BEFORE rendering
  if (payload.platform === "youtube") {
    payload = normalizeYouTubePayload(payload);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "chat-message effect-enter";

  const icon = document.createElement("img");
  icon.className = "platform-icon";
  icon.src = `/icons/${payload.platform}.png`;

  /* ---------------------------------------------------------
     ⭐ Beam relays platforms we may not have an icon for.
     Fall back to the Beam icon rather than showing a broken
     image on stream.
  --------------------------------------------------------- */
  icon.addEventListener("error", () => {
    if (icon.dataset.fallbackApplied) return;
    icon.dataset.fallbackApplied = "1";
    icon.src = payload.via === "beam" ? "/icons/beam.png" : "/icons/velora.png";
  });

  const avatar = payload.avatar
    ? `<img class="inline-avatar" src="${payload.avatar}">`
    : "";

  /* ---------------------------------------------------------
     ⭐ PLATFORM BADGES (Beam added)
  --------------------------------------------------------- */
  let badgesHTML = "";
  if (payload.via === "beam") {
    // ⭐ Relayed through Beam — Beam supplies the badge data for
    // every platform it carries, so use Beam's badge artwork
    // regardless of which platform the message came from.
    badgesHTML = renderBeamBadges(payload);
  } else if (payload.platform === "blaze") {
    badgesHTML = renderBlazeBadges(payload);
  } else if (payload.platform === "velora") {
    badgesHTML = renderVeloraBadges(payload);
  } else if (payload.platform === "youtube") {
    badgesHTML = renderYouTubeBadges(payload);
  } else if (payload.platform === "beam") {
    badgesHTML = renderBeamBadges(payload);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  /* ---------------------------------------------------------
     ⭐ EFFECT LOGIC (Velora only)
  --------------------------------------------------------- */
  if (payload.platform === "velora") {

    // Glow
    if (payload.effect && payload.effect.startsWith("glow_")) {
      const name = payload.effect.replace("glow_", "").toLowerCase();
      bubble.classList.add("effect-color-glow", `effect-glow-${name}`);
    }

    // Galaxy
    if (payload.effect && payload.effect.startsWith("galaxy_")) {
      const name = payload.effect.replace("galaxy_", "").toLowerCase();
      bubble.classList.add("effect-galaxy", `effect-galaxy-${name}`);
    }

    // Rainbow
    if (payload.effect === "rainbow") {
      bubble.classList.add("effect-rainbow");
    }

    // Gigantify — apply ONLY to message text/emotes
    if (payload.effect === "gigantify") {
      requestAnimationFrame(() => {
        const content = bubble.querySelector(".chat-message-content");
        if (!content) return;

        const text = content.querySelector(".text");
        if (text) text.classList.add("effect-gigantify");
      });
    }
  }

  /* ---------------------------------------------------------
     ⭐ FIXED: Volts alerts now show amount
     ⭐ FIXED: Beam stickers restored (new CDN format)
  --------------------------------------------------------- */
  let textContent = payload.html;

  // ⭐ Beam sticker support (new Beam payload format)
  if (payload.platform === "beam" && payload.sticker?.src) {
    const ext = payload.sticker.animated ? "gif" : "png";
    const url = `https://content.beamstream.gg/stickers/${payload.sticker.src}/image.${ext}`;
    textContent = `<img class="beam-sticker" src="${url}">`;
  }

  // ⭐ Velora volts support
  if (payload.platform === "velora" && payload.volts) {
    const amount =
      payload.volts ??
      payload.amount ??
      payload.templateData?.amount ??
      0;

    textContent = `${payload.username} sent ${amount} Volts!`;
  }

  bubble.innerHTML = `
    <div class="chat-message-content">
      <span class="velora-line">
        ${avatar}
        ${badgesHTML}
        <span class="username">${payload.username}</span>
      </span>
      <span class="text">${textContent}</span>
    </div>
  `;

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
   Velora System Alerts (unchanged)
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
    const amount =
      data.volts ??
      data.amount ??
      data.templateData?.amount ??
      0;

    text = `${data.displayName || data.username} sent ${amount} Volts!`;
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

  enqueue({
    soundUrl: data.customSoundUrl || null,
    delayMs: 0,
    ttsText: `Velora Stream Alert. ${text}`
  });

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
