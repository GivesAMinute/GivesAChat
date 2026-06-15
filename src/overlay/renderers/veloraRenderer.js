import {
  applyExit,
  createAvatar,
  createBaseMessageElement,
  createBubble,
  appendBadgesToBubble,
  appendHtmlTextToBubble,
  safeSanitize
} from "./_shared.js";

export function renderVeloraMessage(msg) {
  if (!msg) return null;

  if (msg.type === "reward" || msg.messageType === "reward") {
    return renderVeloraReward(msg);
  }

  const username = msg.username || "Unknown";
  const html = msg.html || "";
  const avatar = msg.avatar || null;
  const badges = msg.badges || [];

  const root = createBaseMessageElement();

  const avatarEl = createAvatar(avatar, username);
  if (avatarEl) root.appendChild(avatarEl);

  const bubble = createBubble(username, "velora");
  appendBadgesToBubble(bubble, badges);
  appendHtmlTextToBubble(bubble, html);

  root.appendChild(bubble);
  applyExit(root);
  return root;
}

function renderVeloraReward(msg) {
  const root = document.createElement("div");
  root.className = "msg velora-reward-msg";

  const card = document.createElement("div");
  card.className = "velora-reward-card";

  const username = msg.username || "Someone";
  const rewardName = msg.rewardName || "Redeemed a reward";
  const rewardIcon = msg.rewardIcon || null;
  const rewardColor = msg.rewardColor || "#ff00ff";
  const rewardHTML = msg.rewardHTML || null;

  card.style.borderColor = rewardColor;

  if (rewardIcon) {
    const icon = document.createElement("img");
    icon.className = "velora-reward-icon";
    icon.src = rewardIcon;
    icon.alt = rewardName;
    card.appendChild(icon);
  }

  const textWrapper = document.createElement("div");
  textWrapper.className = "velora-reward-text";

  const title = document.createElement("div");
  title.className = "velora-reward-title";
  title.textContent = `${username} redeemed: ${rewardName}`;
  textWrapper.appendChild(title);

  if (rewardHTML) {
    const body = document.createElement("div");
    body.className = "velora-reward-body";
    body.innerHTML = safeSanitize(rewardHTML);
    textWrapper.appendChild(body);
  }

  card.appendChild(textWrapper);
  root.appendChild(card);

  applyExit(root);
  return root;
}
