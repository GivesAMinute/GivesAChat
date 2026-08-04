export function renderBlazeBadges(payload) {
  const roles = payload.badges || [];
  const html = [];

  // Broadcaster / Owner FIRST
  if (roles.includes("owner") || payload.isOwner) {
    html.push(`<img class="blaze-badge" src="/badges/blaze/broadcaster.png">`);
  }

  // OG SECOND
  if (roles.includes("og")) {
    html.push(`<img class="blaze-badge" src="/badges/blaze/og.png">`);
  }

  // VIP THIRD
  if (roles.includes("vip")) {
    html.push(`<img class="blaze-badge" src="/badges/blaze/vip.png">`);
  }

  // Moderator LAST
  if (roles.includes("moderator")) {
    html.push(`<img class="blaze-badge" src="/badges/blaze/mod.png">`);
  }

  return html.join("");
}
