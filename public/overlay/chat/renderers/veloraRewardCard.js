// overlay/chat/renderers/veloraRewardCard.js

export function renderVeloraRewardCard(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "velora-reward-card";

  const avatar = msg.avatar
    ? `<img class="velora-reward-avatar" src="${msg.avatar}">`
    : "";

  const icon = msg.rewardIcon
    ? `<img class="velora-reward-icon" src="${msg.rewardIcon}">`
    : "";

  const userInput = msg.userInput
    ? `<div class="velora-reward-input">${msg.userInput}</div>`
    : "";

  const gradient = msg.rewardColor || "#ff0055";

  wrapper.innerHTML = `
    <div class="velora-reward-bg" style="background: linear-gradient(90deg, ${gradient}, #0066ff);">
      ${avatar}
      <div class="velora-reward-text">
        <div class="velora-reward-username">${msg.username}</div>
        <div class="velora-reward-title">${msg.rewardName}</div>
        ${userInput}
      </div>
      ${icon}
    </div>
  `;

  return wrapper;
}
