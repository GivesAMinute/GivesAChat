// public/badges/velora/index.js

export function renderVeloraBadges(msg) {
  let out = "";

  // ---------------------------------------------------------
  // ⭐ 1. Subscriber badge (Velora dynamic URL)
  // ---------------------------------------------------------
  if (msg.subscriptionBadge?.staticAssetUrl) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="${msg.subscriptionBadge.staticAssetUrl}"
             alt="${msg.subscriptionBadge.label}"
             title="${msg.subscriptionBadge.label}">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 2. Broadcaster badge
  // ---------------------------------------------------------
  if (msg.badges?.includes("broadcaster")) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/badges/velora/StreamerBroadcasterBadge.png"
             alt="Broadcaster"
             title="Broadcaster">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 3. Moderator badge
  // ---------------------------------------------------------
  if (msg.badges?.includes("moderator") || msg.isModerator) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/badges/velora/ModeratorModBadge.png"
             alt="Moderator"
             title="Moderator">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 4. VIP badge
  // ---------------------------------------------------------
  if (msg.badges?.includes("vip") || msg.isVip) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/badges/velora/VIPBadge.png"
             alt="VIP"
             title="VIP">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 5. Gift Leader badge
  // ---------------------------------------------------------
  if (msg.badges?.includes("gift_leader") || msg.role === "gift_leader") {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/badges/velora/GifterBadge.png"
             alt="Gift Leader"
             title="Gift Leader">
      </span>
    `;
  }

  return out;
}
