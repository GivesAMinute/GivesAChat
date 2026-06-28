import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   ⭐ Transform Velora Chat WebSocket messages (updated schema)
--------------------------------------------------------- */
export function transformVeloraChatMessage(msg) {
  if (!msg || !msg.data) return null;

  const data = msg.data;
  const user = data.user || {};

  return {
    type: "chat",
    platform: "velora",

    // Dedupe key
    messageId: data.messageId,

    // User identity
    username: user.displayName || user.username,
    avatar: user.avatar || null,

    // Badges
    badges:
      user.badges?.map((slug) => ({
        icon: `https://cdn.velora.tv/badges/${slug}.png`,
        label: slug
      })) || [],

    // Message content (Velora now sends HTML)
    html: sanitizeHtml(data.content?.html || ""),

    // User flags
    isMod: user.roles?.mod || false,
    isVip: user.roles?.vip || false,
    isSubscriber: user.roles?.subscriber || false,
    subscriberMonths: user.subscriberMonths || 0,

    // Accent color
    color: user.color || null
  };
}

/* ---------------------------------------------------------
   ⭐ Transform Velora Events API messages
--------------------------------------------------------- */
export function transformVeloraEvent(event, payload) {
  if (!payload || !payload.data) return null;

  const data = payload.data;
  const user = data.user || {};

  /* ---------------------------------------------------------
     ⭐ Chat messages from Events API (chat.message)
  --------------------------------------------------------- */
  if (event === "chat.message") {
    return {
      type: "chat",
      platform: "velora",

      messageId: data.messageId,
      username: user.displayName || user.username,
      avatar: user.avatar || null,

      badges:
        user.badges?.map((slug) => ({
          icon: `https://cdn.velora.tv/badges/${slug}.png`,
          label: slug
        })) || [],

      html: sanitizeHtml(data.content?.html || ""),

      isMod: user.roles?.mod || false,
      isVip: user.roles?.vip || false,
      isSubscriber: user.roles?.subscriber || false,
      subscriberMonths: user.subscriberMonths || 0,

      color: user.color || null
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

      username: user.displayName || user.username
    };
  }

  return null;
}
