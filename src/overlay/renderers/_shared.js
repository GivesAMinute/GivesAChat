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

export function createBaseMessageElement() {
  const msg = document.createElement("div");
  msg.className = "msg";
  return msg;
}

export function createAvatar(avatarUrl, username) {
  if (!avatarUrl) return null;
  const img = document.createElement("img");
  img.className = "avatar";
  img.src = avatarUrl;
  img.alt = username || "";
  return img;
}

export function createBubble(username, platform) {
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const nameEl = document.createElement("span");
  nameEl.className = "username";
  nameEl.textContent = username || "Unknown";

  const color = safeColorForUsername(username, platform);
  if (color) {
    nameEl.style.color = color;
  }

  bubble.appendChild(nameEl);
  return bubble;
}

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
