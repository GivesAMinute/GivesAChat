// overlay/chat/badges/velora/index.js

export function renderVeloraBadges(msg) {
  if (!msg.badges || !Array.isArray(msg.badges)) return "";

  return msg.badges
    .map(
      (b) =>
        `<span class="tooltip-wrapper">
          <img class="velora-badge" src="${b.icon}" alt="${b.label}" title="${b.label}">
        </span>`
    )
    .join("");
}
