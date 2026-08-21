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

/* ---------------------------------------------------------
   ⭐ Claim card (1st / 2nd to the stream)

   The same gold "Stream Alert" bubble the chat overlay uses,
   with two deliberate differences: no platform icon outside the
   bubble, and no slide-out — this is a standalone card in the
   middle of the screen, not a message in a lane.

   Text is set with textContent, never innerHTML: line1 and line2
   are creator templates with viewer-supplied values substituted
   into them, so they are not trusted markup.
--------------------------------------------------------- */
function buildClaimCard(alert) {
  const bubble = document.createElement("div");
  bubble.className = "velora-system-bubble velora-claim-bubble";

  const header = document.createElement("div");
  header.className = "velora-system-header";

  const logo = document.createElement("img");
  logo.className = "velora-system-logo";
  logo.src = "/icons/velora-horizontal.png";

  const title = document.createElement("span");
  title.className = "velora-system-title";
  title.textContent = "Stream Alert:";

  header.appendChild(logo);
  header.appendChild(title);
  bubble.appendChild(header);

  const body = document.createElement("div");
  body.className = "velora-claim-body";

  const avatar = document.createElement("img");
  avatar.className = "velora-claim-avatar";
  avatar.src = alert.avatarUrl || "/icons/velora.png";
  avatar.alt = "";

  const lines = document.createElement("div");
  lines.className = "velora-claim-lines";

  const card = alert.cardDesign || {};

  /* cardDesign colours are deliberately NOT applied here. Both
     lines are gold with a white stroke, set in CSS, and an inline
     colour from the creator's design would silently win over it. */
  const l1 = document.createElement("div");
  l1.className = "velora-system-text velora-claim-line1";
  l1.textContent = alert.line1 || "";
  lines.appendChild(l1);

  /* Line two is optional by design — a creator may only have
     written one line, and an empty div would still take space. */
  if (alert.line2) {
    const l2 = document.createElement("div");
    l2.className = "velora-system-text velora-claim-line2";
    l2.textContent = alert.line2;
    lines.appendChild(l2);
  }

  body.appendChild(avatar);
  body.appendChild(lines);
  bubble.appendChild(body);

  return bubble;
}

/* ---------------------------------------------------------
   ⭐ Two lines, always

   The card is one line of headline and one of detail. A long
   display name would wrap the headline onto a third line and
   push the card out of shape, so the text is measured after
   layout and the font size stepped down until each line fits.

   Measured rather than guessed: the same string is a different
   width in every font, and OBS, Safari and iPad don't all agree
   on font fallback. scrollWidth vs clientWidth is the only
   answer that's true on the machine actually rendering it.

   Below the floor, shrinking further would be unreadable, so
   the line is allowed to wrap instead — a slightly taller card
   beats text nobody can read.
--------------------------------------------------------- */
const LINE_LIMITS = [
  { selector: ".velora-claim-line1", start: 26, min: 17 },
  { selector: ".velora-claim-line2", start: 19, min: 13 }
];

function fitClaimLines(bubble) {
  for (const { selector, start, min } of LINE_LIMITS) {
    const el = bubble.querySelector(selector);
    if (!el) continue;

    let size = start;
    el.style.fontSize = `${size}px`;

    /* clientWidth is the space available; scrollWidth is what the
       text actually needs on one line. */
    while (el.scrollWidth > el.clientWidth && size > min) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }

    if (el.scrollWidth > el.clientWidth) {
      el.classList.add("velora-claim-wrapped");
    }
  }
}

/**
 * ⭐ Render a single Velora alert
 */
function renderVeloraAlertCardNow(alert) {
  const popupRoot = getVeloraRoot();
  const card = alert.cardDesign || {};
  const duration = alert.duration || card.duration || 8;

  /* Claims get the stream-alert bubble; everything else keeps
     the sticker treatment it already has. */
  if (alert.variant === "claim") {
    const wrapper = document.createElement("div");
    wrapper.className = "velora-card-popup velora-claim-popup";

    const bubble = buildClaimCard(alert);
    wrapper.appendChild(bubble);

    popupRoot.appendChild(wrapper);

    /* Must run after the browser has laid the card out —
       scrollWidth is meaningless on an element not yet in flow.

       And after Inter has actually loaded: measuring while the
       fallback face is still showing sizes the text against the
       wrong metrics, then the swap changes the width underneath
       us. That mis-fit only appears on the FIRST alert of a
       session, which is the one most likely to be missed in
       testing and least forgivable on stream.

       fonts.ready is already resolved on every alert after the
       first, so this costs nothing thereafter. */
    const fit = () => requestAnimationFrame(() => fitClaimLines(bubble));

    if (document.fonts?.ready) document.fonts.ready.then(fit);
    else fit();

    setTimeout(() => {
      wrapper.classList.add("fade-out");
      setTimeout(() => {
        wrapper.remove();
        veloraActive = false;
        showNextVeloraCard();
      }, 800);
    }, duration * 1000);

    return;
  }

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
