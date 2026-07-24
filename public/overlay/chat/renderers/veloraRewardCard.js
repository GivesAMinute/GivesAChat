// overlay/chat/renderers/veloraRewardCard.js

export function renderVeloraRewardCard(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "velora-reward-card";

  const bgEl = document.createElement("div");
  bgEl.className = "velora-reward-bg";

  // ⭐ Noise layer
  const noiseEl = document.createElement("div");
  noiseEl.className = "velora-reward-noise";
  bgEl.appendChild(noiseEl);

  const cd = msg.cardDesign || {};
  const bg = cd.background || {};
  const texture = cd.texture || {};
  const icon = cd.icon || {};
  const text1 = cd.textLine1 || {};
  const text2 = cd.textLine2 || {};
  const border = cd.border || {};

  // ⭐ Background gradient
  if (Array.isArray(bg.colors) && bg.colors.length >= 2) {
    bgEl.style.background = `linear-gradient(${bg.angle || 90}deg, ${bg.colors[0]}, ${bg.colors[1]})`;
  }

  // ⭐ Border
  if (border.color) {
    bgEl.style.border = `${border.width || 3}px solid ${border.color}`;
  }

  // ⭐ Texture overlay
  if (texture.enabled) {
    const texEl = document.createElement("div");
    texEl.className = "velora-reward-texture";
    texEl.style.opacity = (texture.opacity || 10) / 100;
    texEl.style.mixBlendMode = texture.blendMode || "soft-light";
    bgEl.appendChild(texEl);
  }

  // ⭐ Left: avatar (unchanged)
  const leftEl = document.createElement("div");
  leftEl.className = "velora-reward-left";

  const avatarUrl = msg.avatarUrl || msg.avatar;

  if (avatarUrl) {
    const avatarEl = document.createElement("img");
    avatarEl.className = "velora-reward-avatar";
    avatarEl.src = avatarUrl;
    leftEl.appendChild(avatarEl);
  }

  // ⭐ Center: text
  const textEl = document.createElement("div");
  textEl.className = "velora-reward-text";

  // ⭐ textLine1 (username)
  const usernameEl = document.createElement("div");
  usernameEl.className = "velora-reward-textline1";
  usernameEl.textContent =
    text1.content?.replace("{User}", msg.username) || msg.username;

  if (text1.font) usernameEl.style.fontFamily = `"${text1.font}", sans-serif`;

  if (text1.size === "lg") usernameEl.style.fontSize = "20px";
  if (text1.size === "md") usernameEl.style.fontSize = "16px";
  if (text1.size === "sm") usernameEl.style.fontSize = "14px";

  if (text1.color?.value) {
    usernameEl.style.color = text1.color.value;
  } else if (msg.usernameColor) {
    usernameEl.style.color = msg.usernameColor;
  }

  if (text1.animation === "glow") {
    usernameEl.classList.add("velora-text-glow");
  }

  textEl.appendChild(usernameEl);

  // ⭐ textLine2 (reward name)
  const titleEl = document.createElement("div");
  titleEl.className = "velora-reward-textline2";

  const rewardName =
    msg.rewardTitle ||
    msg.rewardName ||
    msg.title ||
    "Reward";

  titleEl.textContent =
    text2.content?.replace("{Reward}", rewardName) || rewardName;

  if (text2.font) titleEl.style.fontFamily = `"${text2.font}", sans-serif`;

  if (text2.size === "lg") titleEl.style.fontSize = "24px";
  if (text2.size === "md") titleEl.style.fontSize = "20px";
  if (text2.size === "sm") titleEl.style.fontSize = "16px";

  if (text2.color?.value) titleEl.style.color = text2.color.value;

  if (text2.animation === "pulse") {
    titleEl.classList.add("velora-text-pulse");
  }

  textEl.appendChild(titleEl);

  // ⭐ Right: reward icon (pulse added here)
  const rightEl = document.createElement("div");
  rightEl.className = "velora-reward-right";

  const iconUrl =
    icon.customIconUrl ||
    icon.emoteUrl ||
    msg.rewardIcon ||
    null;

  if (iconUrl) {
    const iconEl = document.createElement("img");

    // ⭐ Pulse ONLY the reward icon inside the card
    iconEl.className = "velora-reward-icon velora-text-pulse";

    iconEl.src = iconUrl;
    rightEl.appendChild(iconEl);

    wrapper.dataset.rewardIcon = iconUrl;
  }

  // ⭐ Assemble
  bgEl.appendChild(leftEl);
  bgEl.appendChild(textEl);
  bgEl.appendChild(rightEl);
  wrapper.appendChild(bgEl);

  return wrapper;
}
