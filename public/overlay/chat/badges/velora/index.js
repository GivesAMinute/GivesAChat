// overlay/chat/badges/velora/index.js

export function renderVeloraBadges(msg) {
  let out = "";

  // ---------------------------------------------------------
  // ⭐ 1. Velora "badges" array (broadcaster, moderator, vip, etc.)
  // ---------------------------------------------------------
  if (Array.isArray(msg.badges)) {
    for (const b of msg.badges) {
      // Velora sends badges as objects: { icon, label }
      if (b?.icon) {
        out += `
          <span class="tooltip-wrapper">
            <img class="velora-badge" src="${b.icon}" alt="${b.label}" title="${b.label}">
          </span>
        `;
      }
    }
  }

  // ---------------------------------------------------------
  // ⭐ 2. Velora subscription badge (subscriber tiers)
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
  // ⭐ 3. Velora broadcaster badge (your own channel)
  // ---------------------------------------------------------
  if (msg.isStreamer || msg.badges?.includes("broadcaster")) {
    out += `
      <span class="tooltip-wrapper">
        <img class="velora-badge" src="/velora-badges/StreamerBroadcasterBadge.png"
             alt="Broadcaster" title="Broadcaster">
      </span>
    `;
  }

  return out;
}
