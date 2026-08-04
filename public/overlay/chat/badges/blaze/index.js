export function renderBlazeBadges(payload) {
  const roles = payload.badges || [];

  let html = "";

  for (const role of roles) {
    if (role === "moderator") {
      html += `<img class="blaze-badge" src="/badges/blaze/mod.png">`;
    }
    if (role === "vip") {
      html += `<img class="blaze-badge" src="/badges/blaze/vip.png">`;
    }
    if (role === "og") {
      html += `<img class="blaze-badge" src="/badges/blaze/og.png">`;
    }
    if (role === "owner") {
      html += `<img class="blaze-badge" src="/badges/blaze/broadcaster.png">`;
    }
  }

  return html;
}
