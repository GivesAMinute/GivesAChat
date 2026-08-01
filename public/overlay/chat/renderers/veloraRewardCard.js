// overlay/chat/renderers/veloraRewardCard.js

export function renderVeloraRewardCard(msg) {
  /* ---------------------------------------------------------
     ⭐ MATCH CHAT MESSAGE STRUCTURE EXACTLY
  --------------------------------------------------------- */
  const wrapper = document.createElement("div");
  wrapper.className = "chat-message effect-enter velora-reward-card";

  /* ---------------------------------------------------------
     ⭐ PLATFORM ICON (same as chat)
  --------------------------------------------------------- */
  const platformIcon = document.createElement("img");
  platformIcon.className = "platform-icon";
  platformIcon.src = "/icons/velora.png";
  wrapper.appendChild(platformIcon);

  /* ---------------------------------------------------------
     ⭐ BUBBLE (same as chat)
  --------------------------------------------------------- */
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  wrapper.appendChild(bubble);

  /* ---------------------------------------------------------
     ⭐ CHAT MESSAGE CONTENT WRAPPER
  --------------------------------------------------------- */
  const content = document.createElement("div");
  content.className = "chat-message-content";
  bubble.appendChild(content);

  /* ---------------------------------------------------------
     ⭐ VELORA LINE (username + avatar + badges)
  --------------------------------------------------------- */
  const veloraLine = document.createElement("span");
  veloraLine.className = "velora-line";

  // Avatar
  const avatarUrl = msg.avatarUrl || msg.avatar;
  if (avatarUrl) {
    const avatarEl = document.createElement("img");
    avatarEl.className = "inline-avatar";
    avatarEl.src = avatarUrl;
    veloraLine.appendChild(avatarEl);
  }

  // Username
  const usernameEl = document.createElement("span");
  usernameEl.className = "username";
  usernameEl.textContent = msg.username;
  veloraLine.appendChild(usernameEl);

  content.appendChild(veloraLine);

  /* ---------------------------------------------------------
     ⭐ TEXT AREA (reward card visuals go here)
  --------------------------------------------------------- */
  const textWrapper = document.createElement("span");
  textWrapper.className = "text";

  /* ---------------------------------------------------------
     ⭐ Reward Card Visual Container
  --------------------------------------------------------- */
  const card = document.createElement("div");
  card.className = "velora-reward-bg";

  /* Noise */
  const noiseEl = document.createElement("div");
  noiseEl.className = "velora-reward-noise";
  card.appendChild(noiseEl);

  const cd = msg.cardDesign || {};
  const bg = cd.background || {};
  const texture = cd.texture || {};
  const iconCfg = cd.icon || {};
  const text1 = cd.textLine1 || {};
  const text2 = cd.textLine2 || {};
  const border = cd.border || {};

  /* Background gradient */
  if (Array.isArray(bg.colors) && bg.colors.length >= 2) {
    card.style.background = `linear-gradient(${bg.angle || 90}deg, ${bg.colors[0]}, ${bg.colors[1]})`;
  }

  /* Border */
  if (border.color) {
    card.style.border = `${border.width || 3}px solid ${border.color}`;
  }

  /* Texture */
  if (texture.enabled) {
    const texEl = document.createElement("div");
    texEl.className = "velora-reward-texture";
    texEl.style.opacity = (texture.opacity || 10) / 100;
    texEl.style.mixBlendMode = texture.blendMode || "soft-light";
    card.appendChild(texEl);
  }

  /* ---------------------------------------------------------
     ⭐ Left: Avatar (reward card avatar)
  --------------------------------------------------------- */
  const leftEl = document.createElement("div");
  leftEl.className = "velora-reward-left";

  if (avatarUrl) {
    const avatarEl = document.createElement("img");
    avatarEl.className = "velora-reward-avatar";
    avatarEl.src = avatarUrl;
    leftEl.appendChild(avatarEl);
  }

  card.appendChild(leftEl);

  /* ---------------------------------------------------------
     ⭐ Center: Text (NO PULSE)
  --------------------------------------------------------- */
  const textEl = document.createElement("div");
  textEl.className = "velora-reward-text";

  const usernameLine = document.createElement("div");
  usernameLine.className = "velora-reward-textline1";
  usernameLine.textContent =
    text1.content?.replace("{User}", msg.username) || msg.username;

  if (text1.font) usernameLine.style.fontFamily = `"${text1.font}", sans-serif`;
  if (text1.color?.value) usernameLine.style.color = text1.color.value;

  textEl.appendChild(usernameLine);

  const rewardName =
    msg.rewardTitle ||
    msg.rewardName ||
    msg.title ||
    "Reward";

  const rewardLine = document.createElement("div");
  rewardLine.className = "velora-reward-textline2";
  rewardLine.textContent =
    text2.content?.replace("{Reward}", rewardName) || rewardName;

  if (text2.font) rewardLine.style.fontFamily = `"${text2.font}", sans-serif`;
  if (text2.color?.value) rewardLine.style.color = text2.color.value;

  // ⭐ NO TEXT PULSE ANYMORE
  textEl.appendChild(rewardLine);

  card.appendChild(textEl);

  /* ---------------------------------------------------------
     ⭐ Right: Reward Icon (randomized pulse)
  --------------------------------------------------------- */
  const rightEl = document.createElement("div");
  rightEl.className = "velora-reward-right";

  const iconUrl =
    iconCfg.customIconUrl ||
    iconCfg.emoteUrl ||
    msg.rewardIcon ||
    null;

  if (iconUrl) {
    const iconWrap = document.createElement("div");
    iconWrap.className = "velora-reward-icon-wrap";

    const iconEl = document.createElement("img");
    iconEl.className = "velora-reward-icon velora-icon-pulse";
    iconEl.src = iconUrl;

    const rand = Math.random();
    iconEl.style.animationDelay = `${rand * 1.0}s`;
    iconEl.style.animationDuration = `${0.9 + rand * 0.7}s`;

    iconWrap.appendChild(iconEl);
    rightEl.appendChild(iconWrap);

    wrapper.dataset.rewardIcon = iconUrl;
  }

  card.appendChild(rightEl);

  /* ---------------------------------------------------------
     ⭐ Insert reward card into chat bubble
  --------------------------------------------------------- */
  textWrapper.appendChild(card);
  content.appendChild(textWrapper);

  /* ---------------------------------------------------------
     ⭐ Slide-out (same as chat)
  --------------------------------------------------------- */
  setTimeout(() => {
    wrapper.classList.add("fade-out");
    setTimeout(() => wrapper.remove(), 800);
  }, 45000);

  return wrapper;
}
