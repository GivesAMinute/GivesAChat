// platforms/velora/veloraTransform.js
import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   ⭐ Transform Velora Chat WebSocket messages
--------------------------------------------------------- */
export function transformVeloraChatMessage(msg) {
  if (!msg) return null;

  return {
    type: "chat",
    platform: "velora",

    // Dedupe key
    messageId: msg.messageId,

    // User identity
    username: msg.displayName || msg.username,
    avatar: msg.avatarUrl || null,

    // Badges → convert slugs to icon URLs
    badges:
      msg.badges?.map((slug) => ({
        icon: `https://cdn.velora.tv/badges/${slug}.png`,
        label: slug
      })) || [],

    // Message content
    html: sanitizeHtml(msg.message),

    // User flags
    isMod: msg.isMod,
    isVip: msg.isVip,
    isSubscriber: msg.isSubscriber,
    subscriberMonths: msg.subscriberMonths || 0,

    // Accent color
    color: msg.color || null
  };
}

/* ---------------------------------------------------------
   ⭐ Transform Velora Events API messages
--------------------------------------------------------- */
export function transformVeloraEvent(event, payload) {
  if (!payload) return null;

  const { data } = payload;

  /* ---------------------------------------------------------
     ⭐ Chat messages from Events API (chat.message)
     These MUST match the chat WebSocket shape exactly.
  --------------------------------------------------------- */
  if (event === "chat.message") {
    return {
      type: "chat",
      platform: "velora",

      // Dedupe key
      messageId: data.messageId,

      // User identity
      username: data.displayName || data.username,
      avatar: data.avatarUrl || null,

      // Badges
      badges:
        data.badges?.map((slug) => ({
          icon: `https://cdn.velora.tv/badges/${slug}.png`,
          label: slug
        })) || [],

      // Message content
      html: sanitizeHtml(data.message),

      // User flags
      isMod: data.isMod,
      isVip: data.isVip,
      isSubscriber: data.isSubscriber,
      subscriberMonths: data.subscriberMonths || 0,

      // Accent color
      color: data.color || null
    };
  }

  /* ---------------------------------------------------------
     ⭐ Channel Points Redemption (reward cards)
  --------------------------------------------------------- */
  if (event === "channel.channel_points_redemption") {
    return {
      type: "reward",
      platform: "velora",

      redemptionId: data.redemptionId,
      rewardName: data.rewardTitle,
      rewardIcon: data.rewardIcon || null,
      rewardColor: data.rewardColor || null,
      cardDesign: data.cardDesign || null,

      username: data.displayName || data.username
    };
  }

  return null;
}
