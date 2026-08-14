// public/overlay/chat/renderers/youtubeRenderer.js

export function normalizeYouTubePayload(payload) {

  // ⭐ Remove @ prefix
  let username = payload.username || "";
  if (username.startsWith("@")) {
    username = username.substring(1);
  }

  // ⭐ Avatar normalization
  // Beam sometimes sends avatar under different fields
  const avatar =
    payload.avatar ||
    payload.authorPhoto ||
    payload.profileImageUrl ||
    null;

  // ⭐ Unified Velora-style structure
  return {
    platform: "youtube",
    username,
    avatar,
    html: payload.html,
    badges: payload.badges || [],
    effect: payload.effect || null
  };
}
