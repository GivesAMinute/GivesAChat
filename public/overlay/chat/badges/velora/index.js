// overlay/chat/badges/velora/index.js

export function renderVeloraBadges(msg) {
  let out = "";

  // ---------------------------------------------------------
  // ⭐ 1. Subscription badge (Velora sends full URL)
  // ---------------------------------------------------------
  if (msg.subscriptionBadge?.staticAssetUrl) {
    const url = msg.subscriptionBadge.staticAssetUrl;
    const label = msg.subscriptionBadge.label || "Subscriber";

    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge" src="${url}" alt="${label}" title="${label}">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 2. Broadcaster badge (Velora does NOT send an icon)
  // ---------------------------------------------------------
  if (msg.badges?.includes("broadcaster")) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/velora-badges/StreamerBroadcasterBadge.png"
             alt="Broadcaster"
             title="Broadcaster">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 3. Subscriber badge (string badge, no icon)
  // ---------------------------------------------------------
  if (msg.badges?.includes("subscriber") && !msg.subscriptionBadge) {
    // fallback: global subscriber badge
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/velora-badges/SubscriberBadge.png"
             alt="Subscriber"
             title="Subscriber">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 4. Moderator badge (Velora sends string only)
  // ---------------------------------------------------------
  if (msg.badges?.includes("moderator")) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/velora-badges/ModeratorBadge.png"
             alt="Moderator"
             title="Moderator">
      </span>
    `;
  }

  // ---------------------------------------------------------
  // ⭐ 5. VIP badge (string only)
  // ---------------------------------------------------------
  if (msg.badges?.includes("vip")) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge"
             src="/velora-badges/VIPBadge.png"
             alt="VIP"
             title="VIP">
      </span>
    `;
  }

  return out;
}
