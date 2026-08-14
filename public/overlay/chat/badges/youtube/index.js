// public/overlay/chat/badges/youtube/index.js

export function renderYouTubeBadges(payload) {
  const badges = payload.badges || [];
  if (!Array.isArray(badges) || badges.length === 0) return "";

  const parts = [];

  for (const badge of badges) {
    const type = (badge.type || badge).toLowerCase();

    if (type === "moderator") {
      parts.push(
        `<img class="inline-badge youtube-badge youtube-badge-moderator" src="/badges/youtube/moderator.png" alt="Moderator">`
      );
    }

    if (type === "owner" || type === "broadcaster" || type === "channel_owner") {
      parts.push(
        `<img class="inline-badge youtube-badge youtube-badge-owner" src="/badges/youtube/owner.png" alt="Owner">`
      );
    }
  }

  return parts.join("");
}
