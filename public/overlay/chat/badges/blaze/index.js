// overlay/chat/badges/blaze/index.js

export function renderBlazeBadges(msg) {
  let out = "";

  // Blaze now sends an array of absolute badge URLs
  const badges = msg.badges || [];

  for (const url of badges) {
    out += `
<span class="tooltip-wrapper">
  <span class="blaze-badge-wrapper">
    <img src="${url}" class="blaze-badge" alt="badge" />
  </span>
</span>`;
  }

  return out;
}
