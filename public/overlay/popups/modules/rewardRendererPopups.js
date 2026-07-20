// public/overlay/popups/modules/rewardRendererPopups.js

import { playRewardSound } from "/overlay/chat/modules/rewardSounds.js";

/* ---------------------------------------------------------
   ⭐ Detect iOS / iPadOS
--------------------------------------------------------- */
const isIOS = (() => {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
})();

export function handleRewardPopup(payload) {
  console.log("[Popups] handleRewardPopup called with payload:", payload);

  const borderWidth = payload.cardDesign?.border?.width ?? 3;
  console.log("[Popups] borderWidth:", borderWidth);

  if (borderWidth !== 2) {
    console.log("[Popups] Skipping popup, borderWidth !== 2");
    return;
  }

  const popupRoot = document.getElementById("reward-popup");
  console.log("[Popups] popupRoot:", popupRoot);

  if (!popupRoot) {
    console.warn("[Popups] No #reward-popup container found");
    return;
  }

  /* ---------------------------------------------------------
     ⭐ FIX: Velora uses rewardTitle, not rewardName
  --------------------------------------------------------- */
  const rewardName =
    payload.rewardTitle ||   // Velora field
    payload.rewardName ||    // fallback
    payload.title ||         // fallback
    "Reward";

  console.log("[Popups] rewardName:", rewardName);

  const popupIcon =
    payload.cardDesign?.icon?.customIconUrl ||
    payload.cardDesign?.icon?.emoteUrl ||
    payload.rewardIcon ||
    null;

  console.log("[Popups] popupIcon:", popupIcon);

  if (!popupIcon) {
    console.warn("[Popups] No popupIcon resolved");
    return;
  }

  const popup = document.createElement("img");
  popup.className = "reward-popup-image";
  popup.src = popupIcon;

  /* ---------------------------------------------------------
     ⭐ iOS: append popup but hide it visually
     (audio still plays because popup system is invoked)
  --------------------------------------------------------- */
  if (isIOS) {
    popup.style.display = "none";
    console.log("[Popups] iOS detected — popup hidden but audio will play");
  }

  popupRoot.appendChild(popup);
  console.log("[Popups] Popup image appended to DOM");

  /* ---------------------------------------------------------
     ⭐ Play audio (OBS/Desktop/iOS all allowed)
  --------------------------------------------------------- */
  playRewardSound(payload.rewardId);

  /* ---------------------------------------------------------
     ⭐ Fade-out animation (still runs even if hidden)
  --------------------------------------------------------- */
  setTimeout(() => {
    popup.classList.add("fade-out");
    console.log("[Popups] Popup fade-out started");
    setTimeout(() => {
      popup.remove();
      console.log("[Popups] Popup removed from DOM");
    }, 800);
  }, 4000);
}
