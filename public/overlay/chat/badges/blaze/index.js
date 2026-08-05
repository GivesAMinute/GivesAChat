export function renderBlazeBadges(payload) {
  const roles = payload.badges || [];
  const badges = [];

  if (payload.isOwner) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/broadcaster.png">`);
  }

  if (roles.includes("og")) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/og.png">`);
  }

  if (roles.includes("vip")) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/vip.png">`);
  }

  if (roles.includes("moderator")) {
    badges.push(`<img class="blaze-badge" src="/badges/blaze/mod.png">`);
  }

  return `
    <span class="blaze-badge-group">
      ${badges.join("")}
    </span>
  `;
}
