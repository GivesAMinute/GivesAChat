// givesachat-cloudflare/src/youtubeTransform.js

import { youtubeEmotes } from "./youtubeEmotes.js";

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

  if (type !== "textMessageEvent") return null;

  let html = displayMessage;

  html = html.replace(/:([a-zA-Z0-9\-_]+):/g, (match) => {
    const url = youtubeEmotes[match];
    if (!url) return match;
    return `<img class="emote youtube-emote" src="${url}" alt="${match}" width="32" height="32">`;
  });

  return {
    platform: "youtube",
    type: "chat-message",
    id: raw.id,
    timestamp: publishedAt,
    username: displayName,
    avatar: profileImageUrl,
    html,
    badges: {
      owner: !!isChatOwner,
      moderator: !!isChatModerator,
      sponsor: !!isChatSponsor
    }
  };
}
