export function renderBeamBadges(payload) {
  const badges = payload.badges || [];
  if (!Array.isArray(badges) || badges.length === 0) return "";

  const parts = [];

  for (const badge of badges) {
    const type = (badge.type || badge).toLowerCase();

    // ⭐ Owner
    if (type === "owner" || type === "broadcaster" || type === "channel_owner") {
      parts.push(
        `<img class="inline-badge beam-badge beam-badge-owner" src="/badges/beam/owner.png" alt="Owner">`
      );
    }

    // ⭐ Verified
    if (type === "verified") {
      parts.push(
        `<img class="inline-badge beam-badge beam-badge-verified" src="/badges/beam/verified.png" alt="Verified">`
      );
    }

    // ⭐ Moderator
    if (type === "moderator") {
      parts.push(
        `<img class="inline-badge beam-badge beam-badge-moderator" src="/badges/beam/moderator.png" alt="Moderator">`
      );
    }
  }

  return parts.join("");
}
