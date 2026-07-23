// givesachat-cloudflare/src/youtubeTransform.js

// Normalizes YouTube live chat messages into your internal event shape.

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

  // Basic text message only for now
  if (type !== "textMessageEvent") return null;

  return {
    platform: "youtube",
    type: "chat-message",
    id: raw.id,
    timestamp: publishedAt,
    message: displayMessage,
    user: {
      name: displayName,
      avatar: profileImageUrl,
      badges: {
        owner: !!isChatOwner,
        moderator: !!isChatModerator,
        sponsor: !!isChatSponsor
      }
    }
  };
}
