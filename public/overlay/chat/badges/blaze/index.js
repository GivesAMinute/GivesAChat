export function renderBlazeBadges(payload) {
  const roles = payload.badges || [];
  const badges = [];

  // Broadcaster / Owner FIRST
  if (payload.isOwner) {
    badges.push(`<img class="blaze-badge broadcaster" src="/badges/blaze/broadcaster.png">`);
  }

  // OG SECOND
  if (roles.includes("og")) {
    badges.push(`<img class="blaze-badge og" src="/badges/blaze/og.png">`);
  }

  // VIP THIRD
  if (roles.includes("vip")) {
    badges.push(`<img class="blaze-badge vip" src="/badges/blaze/vip.png">`);
  }

  // Moderator LAST — includes .mod class for spacing fix
  if (roles.includes("moderator")) {
    badges.push(`<img class="blaze-badge mod" src="/badges/blaze/mod.png">`);
  }

  // No whitespace, single flex wrapper
  return `<span class="blaze-badge-group">${badges.join("")}</span>`;
}
