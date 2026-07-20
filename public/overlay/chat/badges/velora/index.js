// public/overlay/chat/badges/velora/index.js

import { wrapWithTooltip } from "../../utils/tooltip.js";

export function renderVeloraBadges(msg) {
  let out = `<span class="velora-badges">`;

  // ---------------------------------------------------------
  // ⭐ Velora defines badge ORDER in msg.badges (array)
  // ---------------------------------------------------------
  const ordered = Array.isArray(msg.badges) ? msg.badges : [];

  for (const badgeId of ordered) {
    // -------------------------------------------------------
    // ⭐ Subscriber badge (Velora dynamic URL)
    // -------------------------------------------------------
    if (badgeId === "subscription") {
      if (msg.subscriptionBadge?.staticAssetUrl) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="${msg.subscriptionBadge.staticAssetUrl}"
               alt="${msg.subscriptionBadge.label}"
               title="${msg.subscriptionBadge.label}">
        `, msg.subscriptionBadge.label);
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ Broadcaster
    // -------------------------------------------------------
    if (badgeId === "broadcaster") {
      if (msg.badges?.includes("broadcaster")) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/StreamerBroadcasterBadge.png"
               alt="Broadcaster"
               title="Broadcaster">
        `, "Broadcaster");
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ Moderator
    // -------------------------------------------------------
    if (badgeId === "moderator") {
      if (msg.badges?.includes("moderator") || msg.isModerator) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/ModeratorModBadge.png"
               alt="Moderator"
               title="Moderator">
        `, "Moderator");
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ VIP
    // -------------------------------------------------------
    if (badgeId === "vip") {
      if (msg.badges?.includes("vip") || msg.isVip) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/VIPBadge.png"
               alt="VIP"
               title="VIP">
        `, "VIP");
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ Gift Leader
    // -------------------------------------------------------
    if (badgeId === "gift_leader") {
      if (msg.badges?.includes("gift_leader") || msg.role === "gift_leader") {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/GifterBadge.png"
               alt="Gift Leader"
               title="Gift Leader">
        `, "Gift Leader");
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ Pride Month 2026 (NEW)
    // -------------------------------------------------------
    if (badgeId === "pride-month-2026") {
      if (msg.badges?.includes("pride-month-2026")) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="https://assets.velora.tv/badges/catalog/pride-month-2026/static-7750079e-edbe-427f-8e80-298945352e1e.png"
               alt="Pride Month 2026"
               title="Pride Month 2026">
        `, "Pride Month 2026");
      }
      continue;
    }

    // Unknown badge IDs: ignore (matches Railway behavior)
  }

  out += `</span>`;
  return out;
}
