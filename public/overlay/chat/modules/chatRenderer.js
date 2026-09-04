import { speakText } from "./tts.js";
import { renderBlazeBadges } from "../badges/blaze/index.js";
import { renderVeloraBadges } from "../badges/velora/index.js";
import { renderYouTubeBadges } from "../badges/youtube/index.js";
import { renderBeamBadges } from "../badges/beam/index.js";   // ⭐ ADDED
import { renderOdyseeBadges } from "../badges/odysee/index.js";
import { colorForUsername } from "../utils/usernameColors.js";
import { scheduleExit } from "./chatMode.js";
import { linkify } from "../utils/linkify.js";
import {
  veloraCardValues,
  renderVeloraTemplate
} from "/overlay/shared/veloraCardVariables.js";   // ⭐ same module the popups use

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

  /* ---------------------------------------------------------
     ⭐ Every avatar also carries a per-platform class
     (avatar-pilled, avatar-kick, avatar-velora...) so any one
     platform can be resized in CSS alone. Useful where the
     artwork has padding baked in and needs a larger box to
     look the same size — Pilled being the case in point.
  --------------------------------------------------------- */
  const platformClass = String(payload.platform || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  const avatar = payload.avatar
    ? `<img class="inline-avatar avatar-${platformClass}" src="${payload.avatar}">`
    : "";

  /* ---------------------------------------------------------
     ⭐ PLATFORM BADGES (Beam added)
  --------------------------------------------------------- */
  let badgesHTML = "";
  if (payload.platform === "blaze") {
    /* ⭐ Blaze BEFORE the via check, deliberately.
       Blaze now arrives relayed through Beam, and the rule below
       would hand it Beam's crown-and-wrench artwork. We have
       Blaze's own badges, so it keeps them — the whole point of
       moving the pull to Beam was that the render not change.
       beamTransform maps its roles into the shape this expects. */
    badgesHTML = renderBlazeBadges(payload);
  } else if (payload.via === "beam") {
    // ⭐ Relayed through Beam — Beam supplies the badge data for
    // every platform it carries, so use Beam's badge artwork
    // regardless of which platform the message came from.
    badgesHTML = renderBeamBadges(payload);
  } else if (payload.platform === "velora") {
    badgesHTML = renderVeloraBadges(payload);
  } else if (payload.platform === "youtube") {
    badgesHTML = renderYouTubeBadges(payload);
  } else if (payload.platform === "beam") {
    badgesHTML = renderBeamBadges(payload);
  } else if (payload.platform === "odysee") {
    badgesHTML = renderOdyseeBadges(payload);
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

  // ⭐ Make URLs clickable. Runs on text nodes only, after the
  // sanitised HTML is in the DOM — see utils/linkify.js.
  linkify(wrapper.querySelector(".text") || bubble);

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

  scheduleExit(wrapper);
}

/* ---------------------------------------------------------
   ⭐ Who the alert is about.

   Confirmed against a real channel.stream_alert payload — the
   name is carried in FOUR places at once:

     displayName                "GivesAMinute"
     username                   "GivesAMinute"
     templateData.displayName   "GivesAMinute"
     templateData.username      "GivesAMinute"

   Top level is checked first because that is what Velora
   documents, with templateData behind it. That ordering matters:
   the raid that caused this had nothing at the top level while
   templateData.viewers still held the count, so templateData
   survives on payloads where the top level does not.

   Returns null when nothing is found, so the caller can decide
   how to degrade. It must never return undefined or the string
   "undefined" — a template literal stringifies both, which is
   how "undefined raided with 8 viewers!" reached the stream.
--------------------------------------------------------- */
function pickAlertName(data = {}) {
  const t = data.templateData || {};

  const candidates = [
    data.displayName, data.username,
    t.displayName, t.username
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  return null;
}

/* ---------------------------------------------------------
   Velora System Alerts
--------------------------------------------------------- */
function renderVeloraSystemMessage(event, data, container) {
  if (!container) return;
  if (event !== "channel.stream_alert") return;

  let text = "";

  /* Claims get a second line ("...has been 1st 1 time!"). Every
     other alert type leaves this empty and renders exactly as
     before. */
  let claimLine2 = "";

  /* ---------------------------------------------------------
     ⭐ NEVER INTERPOLATE A NAME THAT MIGHT NOT BE THERE.

     Every branch below used to read `data.displayName ||
     data.username` with no final fallback. When Velora sends an
     alert without those fields, `undefined || undefined` is
     undefined and `null || null` is null — and template literals
     stringify both, so the overlay cheerfully rendered

       "undefined raided with 8 viewers!"
       "null raided with viewers!"

     on stream during a real raid.

     A missing name should degrade to something a viewer can read,
     not print the reason it is missing.
  --------------------------------------------------------- */
  const named = pickAlertName(data);

  /* ---------------------------------------------------------
     ⭐ When we cannot name them, use Velora's own sentence.

     The payload carries a fully rendered summary at the top
     level — on the raid test it reads exactly

       "GivesAMinute raided with 42 viewers!"

     which is the sentence this function spends its time
     rebuilding. So if the name is missing, Velora's version is
     strictly better than anything assembled around a placeholder,
     and it is what their own alert shows.

     Note this is the TOP-LEVEL message, not templateData.message
     — that one held "This is a test alert!", a different field
     with a confusingly similar name.
  --------------------------------------------------------- */
  const veloraSentence =
    typeof data.message === "string" && data.message.trim()
      ? data.message.trim()
      : null;

  const who = named || "Someone";

  if (!named && veloraSentence) {
    text = veloraSentence;
  }
  else if (data.alertType === "follow") {
    text = `${who} just followed!`;
  }
  else if (data.alertType === "subscribe") {
    text = `${who} subscribed at Tier 1!`;
  }
  else if (data.alertType === "gift") {
    /* Same trap on the count: "gifted  sub(s)!" reads as broken.
       Without a number, say the thing that is still true. */
    text = data.count
      ? `${who} gifted ${data.count} sub(s)!`
      : `${who} gifted a sub!`;
  }
  else if (data.alertType === "raid") {
    const viewers = data.viewers ?? data.count ?? data.templateData?.viewers;
    text = viewers
      ? `${who} raided with ${viewers} viewers!`
      : `${who} raided!`;
  }
  /* ---------------------------------------------------------
     ⭐ 1st / 2nd to the stream.

     The celebration lives in the popups overlay — card, sound,
     confetti, balloons — but that overlay is not always open.
     On an IRL stream the lane is the only thing on screen, and a
     claim was invisible there.

     The worker composes the sentence, because reward.name arrives
     null on every redemption observed and the lane cannot derive
     the place from the payload the way the popups can from
     Velora's socket. So this prefers data.message and only builds
     its own as a fallback.

     Written as its own branch rather than left to the `else`
     below. That default would render this correctly today, but
     only by accident — nothing about it says a claim is meant to
     land there.
  --------------------------------------------------------- */
  else if (data.alertType === "claim") {
    /* ---------------------------------------------------------
       ⭐ Same two lines as the popup card, from the same code.

       Velora's own alert reads:

         RobMac7733 was 1st to the stream!
         RobMac7733 has been 1st 1 time!

       Neither line is composed here. Both are Velora's cardDesign
       templates rendered through the shared substitution module —
       the identical call the popups make in buildClaimText(). If
       the creator edits the wording in Velora, both surfaces
       follow, and neither can drift from the other, because there
       is one implementation rather than two.

       data.message stays as the fallback for line 1 when
       cardDesign is absent; line 2 simply does not render, which
       is better than inventing a count.
    --------------------------------------------------------- */
    const values = veloraCardValues(data, { place: data.place || "" });
    const design = data.cardDesign || {};

    text =
      renderVeloraTemplate(design.textLine1?.content, values).trim() ||
      veloraSentence ||
      (data.place
        ? `${who} was ${data.place} to the stream!`
        : `${who} claimed a spot on the stream!`);

    claimLine2 = renderVeloraTemplate(design.textLine2?.content, values).trim();
  }
  else if (data.alertType === "volts") {
    /* ---------------------------------------------------------
       ⭐ data.count IS WHERE THE NUMBER ACTUALLY IS.

       A real 120 Volts rendered as "sent 0 Volts!" on stream. The
       number was never missing — the worker had it and this read
       the wrong field.

       transformVeloraEvent() collapses Velora's amount into
       `count` for every alert type:

         count: data.count || data.amount || data.total || null

       so by the time an alert reaches the lane the value is on
       `count`, and `amount` no longer exists. The gift branch
       above reads count and works; this one listed every name
       EXCEPT count and fell through to its default.

       The other names are kept ahead of it: the popups overlay
       takes the same payloads from Velora's socket, where they
       are still flat.
    --------------------------------------------------------- */
    const amount =
      data.volts ??
      data.amount ??
      data.count ??
      data.templateData?.amount ??
      null;

    /* ---------------------------------------------------------
       ⭐ NO NUMBER IS NOT ZERO.

       The old default was 0, so a missing value became a positive
       claim that someone sent nothing — worse than saying less,
       and insulting to whoever just sent Volts. Same rule as the
       raid and gift branches: when the count is unknown, say the
       part that is still true.
    --------------------------------------------------------- */
    const n = Number(amount);

    text = Number.isFinite(n) && n > 0
      ? `${who} sent ${n} Volts!`
      : `${who} sent Volts!`;
  }
  else {
    text = data.message || who;
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
    ${claimLine2 ? `
    <div class="chat-message-content">
      <span class="text velora-system-subtext">${claimLine2}</span>
    </div>` : ""}
  `;

  wrapper.appendChild(icon);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);

  enqueue({
    soundUrl: data.customSoundUrl || null,
    delayMs: 0,
    ttsText: `Velora Stream Alert. ${text}${claimLine2 ? " " + claimLine2 : ""}`
  });

  scheduleExit(wrapper);
}

export {
  handleChat,
  isEmoteOnlyMessage,
  extractEmoteNames,
  formatEmoteList,
  renderVeloraSystemMessage
};
