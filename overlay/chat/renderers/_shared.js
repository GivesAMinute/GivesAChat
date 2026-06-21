/* ---------------------------------------------------------
   SANITIZATION + COLORS + EXIT
--------------------------------------------------------- */

export function safeSanitize(html) {
  const raw = html || "";
  if (typeof window !== "undefined" && window.sanitizeHTML) {
    try {
      return window.sanitizeHTML(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function safeColorForUsername(username, platform) {
  if (typeof window !== "undefined" && window.colorForUsername) {
    try {
      return window.colorForUsername(username || "", platform || "");
    } catch {
      return "";
    }
  }
  return "";
}

export function applyExit(el) {
  if (!el) return;
  if (typeof window !== "undefined" && window.applyExitAnimation) {
    try {
      window.applyExitAnimation(el);
      return;
    } catch {}
  }
  setTimeout(() => {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }, 45000);
}

/* ---------------------------------------------------------
   ⭐ PLATFORM ICON SYSTEM (ported from V6)
--------------------------------------------------------- */

const PLATFORM_MAP = {
  youtube: "youtube",
  "youtube.com": "youtube",
  yt: "youtube",

  velora: "velora",
  "velora.live": "velora",

  pilled: "pilled",
  "pilled.net": "pilled",

  nimotv: "nimotv",
  nimo: "nimotv",

  kick: "kick",
  "kick.com": "kick",

  rumble: "rumble",
  odysee: "odysee",
  arena: "arena",

  blaze: "blaze",

  bitchute: "bitchute",
  vpzone: "vpzone",

  twitch: "twitch",
  beam: "beam"
};

export function getPlatformIcon(platformRaw) {
  if (!platformRaw) return null;
  const platform = String(platformRaw).toLowerCase();
  const mapped = PLATFORM_MAP[platform];
  if (mapped === null) return null;
  if (mapped) return `/icons/${mapped}.png`;
  return `/icons/default.png`;
}

export function createPlatformIcon(platform) {
  const src = getPlatformIcon(platform);
  if (!src) return null;

  const wrapper = document.createElement("span");
  wrapper.className = "tooltip-wrapper";

  const img = document.createElement("img");
  img.className = "platform-icon";
  img.src = src;
  img.alt = platform || "";

  const tooltip = document.createElement("span");
  tooltip.className = "tooltip-bubble";
  tooltip.textContent = (platform || "").toUpperCase();

  wrapper.appendChild(img);
  wrapper.appendChild(tooltip);
  return wrapper;
}

/* ---------------------------------------------------------
   ⭐ BASE MESSAGE ELEMENT
--------------------------------------------------------- */

export function createBaseMessageElement(platform) {
  const msg = document.createElement("div");
  msg.className = "msg";

  if (platform) {
    msg.classList.add(`platform-${platform.toLowerCase()}`);
  }

  const icon = createPlatformIcon(platform);
  if (icon) msg.appendChild(icon);

  return msg;
}

/* ---------------------------------------------------------
   ⭐ BUBBLE (avatar INSIDE bubble)
--------------------------------------------------------- */

export function createBubble(username, platform, avatarUrl) {
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // ⭐ Avatar INSIDE bubble (V6 style)
  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "inline-avatar";
    img.src = avatarUrl;
    img.alt = username || "";
    bubble.appendChild(img);
  }

  // Username
  const nameEl = document.createElement("span");
  nameEl.className = "username";
  nameEl.textContent = username || "Unknown";

  const color = safeColorForUsername(username, platform);
  if (color) nameEl.style.color = color;

  bubble.appendChild(nameEl);

  return bubble;
}

/* ---------------------------------------------------------
   BADGES + HTML TEXT
--------------------------------------------------------- */

export function appendBadgesToBubble(bubble, badges) {
  if (!bubble) return;
  if (!Array.isArray(badges) || badges.length === 0) return;

  const wrapper = document.createElement("span");
  wrapper.className = "badges-wrapper";

  badges.forEach((b) => {
    if (!b) return;

    if (typeof b === "string") {
      const img = document.createElement("img");
      img.src = b;
      img.alt = "";
      img.className = "badge-icon";
      wrapper.appendChild(img);
    } else if (typeof b === "object") {
      const span = document.createElement("span");
      span.className = "badge";

      if (b.icon) {
        const img = document.createElement("img");
        img.src = b.icon;
        img.alt = b.label || "";
        img.className = "badge-icon";
        span.appendChild(img);
      }

      if (b.label) {
        const label = document.createElement("span");
        label.className = "badge-label";
        label.textContent = b.label;
        span.appendChild(label);
      }

      wrapper.appendChild(span);
    }
  });

  bubble.appendChild(wrapper);
}

export function appendHtmlTextToBubble(bubble, html) {
  if (!bubble) return;
  const textEl = document.createElement("span");
  textEl.className = "text";
  textEl.innerHTML = safeSanitize(html);
  bubble.appendChild(textEl);
}
