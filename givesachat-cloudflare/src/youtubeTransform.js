// givesachat-cloudflare/src/youtubeTransform.js

export function transformYouTubeMessage(raw) {
  if (!raw || !raw.snippet || !raw.authorDetails) return null;

  const {
    displayMessage,
    publishedAt,
    type
  } = raw.snippet;

  const {
    displayName,
    profileImageUrl,
    isChatOwner,
    isChatModerator,
    isChatSponsor
  } = raw.authorDetails;

  // Only text messages for now
  if (type !== "textMessageEvent") return null;

  return {
    platform: "youtube",
    type: "chat-message",
    id: raw.id,
    timestamp: publishedAt,
    username: displayName,
    avatar: profileImageUrl,
    html: displayMessage,
    badges: {
      owner: !!isChatOwner,
      moderator: !!isChatModerator,
      sponsor: !!isChatSponsor
    }
  };
}
