// public/overlay/popups/modules/veloraRendererPopups.js

const veloraQueue = [];
let veloraActive = false;

const BASE_CUSTOM_MEDIA_FONT_SIZE = 64;

let VELORA_FONTS = {};
let VELORA_CUSTOM_FONTS = {};

/**
 * Fetch Velora built-in + custom fonts once at startup
 */
export async function loadVeloraFonts() {
  try {
    const builtinRes = await fetch("https://api.velora.tv/fonts");
    const builtinJson = await builtinRes.json();

    const builtinList = Array.isArray(builtinJson)
      ? builtinJson
      : builtinJson.fonts || builtinJson.data || [];

    if (Array.isArray(builtinList)) {
      builtinList.forEach(font => {
        if (font.name && font.url) {
          VELORA_FONTS[font.name] = font.url;
        }
      });
    }

    const customRes = await fetch("https://api.velora.tv/api/fonts/custom");
    const customJson = await customRes.json();

    if (customJson.fonts) {
      customJson.fonts.forEach(font => {
        if (font.files && font.files.regular) {
          VELORA_CUSTOM_FONTS[font.family] = font.files.regular;
        }
      });
    }

  } catch (err) {
    console.error("[Popups] Failed to load Velora fonts:", err);
  }
}

function injectFontFace(fontFamily, fontUrl) {
  if (document.getElementById(`velora-font-${fontFamily}`)) return;

  const style = document.createElement("style");
  style.id = `velora-font-${fontFamily}`;
  style.textContent = `
    @font-face {
      font-family: '${fontFamily}';
      src: url('${fontUrl}');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
  `;
  document.head.appendChild(style);
}

function loadVeloraFont(fontFamily) {
  if (VELORA_CUSTOM_FONTS[fontFamily]) {
    injectFontFace(fontFamily, VELORA_CUSTOM_FONTS[fontFamily]);
    return;
  }

  if (VELORA_FONTS[fontFamily]) {
    injectFontFace(fontFamily, VELORA_FONTS[fontFamily]);
    return;
  }

  const encoded = fontFamily.replace(/ /g, "+");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
  document.head.appendChild(link);
}

function getVeloraRoot() {
  let root = document.getElementById("velora-popup");
  if (!root) {
    root = document.createElement("div");
    root.id = "velora-popup";
    root.style.position = "absolute";
    root.style.top = "50%";
    root.style.left = "50%";
    root.style.transform = "translate(-50%, -50%)";
    root.style.width = "520px";
    root.style.height = "520px";
    root.style.pointerEvents = "none";
    root.style.zIndex = "999998";
    document.getElementById("overlay-root").appendChild(root);
  }
  return root;
}

function showNextVeloraCard() {
  if (veloraActive) return;
  if (veloraQueue.length === 0) return;

  veloraActive = true;
  const alert = veloraQueue.shift();
  renderVeloraAlertCardNow(alert);
}

export function renderVeloraAlertCard(alert) {
  veloraQueue.push(alert);
  showNextVeloraCard();
}

function resolveVeloraAnimation(eventType) {
  if (eventType === "channel.volts") return "velora-anim-volts";
  if (eventType === "channel.subscribe") return "velora-anim-subscription";
  if (eventType === "channel.subscription.gift") return "velora-anim-gift";
  return "velora-anim-cardAdded";
}

/* ---------------------------------------------------------
   ⭐ Resolve popup text using Velora Events API payload
--------------------------------------------------------- */
function resolvePopupText(alert) {
  // Velora Events API ALWAYS provides the correct text here
  if (alert.message) {
    return alert.message;
  }

  const user = alert.displayName || alert.username || "User";
  const reward = alert.rewardTitle || alert.rewardName || "Reward";
  const amount = alert.amount || alert.templateData?.amount || "";

  switch (alert.alertType || alert.event) {
    case "follow":
      return `${user} just followed!`;
    case "subscribe":
      return `${user} subscribed!`;
    case "gift":
      return `${user} gifted ${amount} subs!`;
    case "raid":
      return `${user} is raiding with ${amount} viewers!`;
    case "volts":
      return `${user} sent ${amount} volts!`;
    case "channel_points_redemption":
      return `${user}: ${reward}`;
    default:
      return user;
  }
}

/**
 * ⭐ Render a single Velora alert
 */
function renderVeloraAlertCardNow(alert) {
  const popupRoot = getVeloraRoot();
  const card = alert.cardDesign || {};
  const duration = alert.duration || card.duration || 8;

  const wrapper = document.createElement("div");
  wrapper.className = "velora-card-popup " + resolveVeloraAnimation(alert.event);

  /* IMAGE */
  const img = document.createElement("img");
  img.className = "velora-card-image";
  img.src =
    alert.customImageUrl ||
    card.icon?.customIconUrl ||
    card.icon?.emoteUrl ||
    card.mediaUrl ||
    null;

  wrapper.appendChild(img);

  /* TEXT */
  const text = document.createElement("div");
  text.className = "velora-card-text";

  text.textContent = resolvePopupText(alert);

  if (alert.customMediaTextFont) {
    loadVeloraFont(alert.customMediaTextFont);
    text.style.fontFamily = `${alert.customMediaTextFont}, Inter, system-ui, sans-serif`;
  }

  const scale = alert.customMediaTextScale
    ? parseFloat(alert.customMediaTextScale)
    : 1.0;

  text.style.fontSize = `${BASE_CUSTOM_MEDIA_FONT_SIZE * scale}px`;

  if (card.textLine1?.color) {
    text.style.color = card.textLine1.color;
  }

  if (alert.customMediaTextAlign) {
    text.style.textAlign = alert.customMediaTextAlign;
  }

  wrapper.appendChild(text);

  popupRoot.appendChild(wrapper);

  /* SOUND */
  const soundUrl = alert.customSoundUrl || alert.soundUrl || null;
  if (soundUrl) {
    try {
      const audio = new Audio(soundUrl);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    } catch {}
  }

  /* DURATION */
  setTimeout(() => {
    wrapper.classList.add("fade-out");
    setTimeout(() => {
      wrapper.remove();
      veloraActive = false;
      showNextVeloraCard();
    }, 800);
  }, duration * 1000);
}
