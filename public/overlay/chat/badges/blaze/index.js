export function renderBlazeBadges(payload) {
  const roles = payload.badges || [];
  const badges = [];

  // ⭐ Broadcaster / Owner FIRST
  if (payload.isOwner) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/broadcaster.png">`);
  }

  // ⭐ OG SECOND
  if (roles.includes("og")) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/og.png">`);
  }

  // ⭐ VIP THIRD
  if (roles.includes("vip")) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/vip.png">`);
  }

  // ⭐ Moderator LAST
  if (roles.includes("moderator")) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/mod.png">`);
  }

  // ⭐ THIS IS THE FIX — wrap all badges in ONE flex container
  return `
    <span class="blaze-badge-group">
      ${badges.join("")}
    </span>
  `;
}
