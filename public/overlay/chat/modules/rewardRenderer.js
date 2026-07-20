// public/overlay/chat/modules/rewardRenderer.js

import { renderVeloraRewardCard } from "../renderers/veloraRewardCard.js";
import { playRewardSound } from "./rewardSounds.js";

/**
 * Detect OBS / GoLightstream browser source.
 * We disable popups ONLY in OBS — chat lane still renders normally.
 *
 * ⭐ IMPORTANT:
 * - iPad/iOS must NOT be suppressed
 * - Desktop browser must NOT be suppressed
 * - Only OBS browser source should be suppressed
 */
function isOBSBrowserSource() {
  const ua = navigator.userAgent || "";
  return ua.includes("OBS");   // ⭐ FIXED: URL check removed
}

export function handleReward(payload, container) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-message platform-velora effect-enter";

  const icon = document.createElement("img");
  icon.className = "platform-icon";
  icon.src = `/icons/${payload.platform}.png`;
  wrapper.appendChild(icon);

  const cardEl = renderVeloraRewardCard(payload);
  wrapper.appendChild(cardEl);

  container.appendChild(wrapper);

  const borderWidth = payload.cardDesign?.border?.width ?? 3;

  /**
   * ⭐ POPUP LOGIC
   * - iOS / iPad / Desktop → popup allowed
   * - OBS / GoLightstream → popup suppressed (popups overlay handles it)
   */
  const suppressPopup = isOBSBrowserSource();

  if (!suppressPopup && borderWidth === 2) {
    const popupIcon =
      cardEl.dataset.rewardIcon ||
      payload.rewardIcon ||
      null;

    if (popupIcon) {
      const popup = document.createElement("img");
      popup.className = "reward-popup-image";
      popup.src = popupIcon;

      const popupRoot = document.getElementById("reward-popup");
      if (popupRoot) {
        popupRoot.appendChild(popup);

        setTimeout(() => {
          popup.classList.add("fade-out");
          setTimeout(() => popup.remove(), 800);
        }, 4000);
      }
    }
  } else {
    if (suppressPopup) {
      console.log("[Chat] OBS detected — popup suppressed (handled by popups overlay)");
    }
  }

  // Play reward sound everywhere (chat lane always handles audio)
  playRewardSound(payload.rewardId);

  // Fade out chat lane card
  setTimeout(() => {
    wrapper.classList.add("fade-out");
    setTimeout(() => wrapper.remove(), 800);
  }, 45000);
}
