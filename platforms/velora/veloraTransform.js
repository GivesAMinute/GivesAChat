import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   ⭐ Transform Velora Chat WebSocket messages (newMessage)
   Schema: https://api.velora.tv/chat
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

    // Badges
    badges:
      msg.badges?.map((slug) => ({
        icon: `https://cdn.velora.tv/badges/${slug}.png`,
        label: slug
      })) || [],

    // Message content (Chat WS uses plain text)
    html: sanitizeHtml(msg.message || ""),

    // User flags
    isMod: msg.isMod || false,
    isVip: msg.isVip || false,
    isSubscriber: msg.isSubscriber || false,
    subscriberMonths: msg.subscriberMonths || 0,

    // Accent color
    color: msg.color || null
  };
}

/* ---------------------------------------------------------
   ⭐ Transform Velora Events API messages (event: "chat.message")
   Schema: https://api.velora.tv/ws/events
--------------------------------------------------------- */
export function transformVeloraEvent(event, payload) {
  if (!payload || !payload.data) return null;

  const data = payload.data;
  const user = data.user || {};

  /* ---------------------------------------------------------
     ⭐ Chat messages from Events API (chat.message)
     These include stickers, sounds, celebrations, etc.
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

      // Events API uses HTML content
      html: sanitizeHtml(data.content?.html || ""),

      isMod: user.roles?.mod || false,
      isVip: user.roles?.vip || false,
      isSubscriber: user.roles?.subscriber || false,
      subscriberMonths: user.subscriberMonths || 0,

      color: user.color || null,

      // Card messages (stickers, sounds, celebrations)
      card: data.card || null
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
      rewardCost: data.rewardCost,
      rewardId: data.rewardId,

      username: user.displayName || user.username,
      avatar: user.avatar || null,

      userInput: data.userInput || null,
      redeemedAt: data.redeemedAt || null,

      // Optional card design fields
      rewardIcon: data.rewardIcon || null,
      rewardColor: data.rewardColor || null,
      cardDesign: data.cardDesign || null
    };
  }

  /* ---------------------------------------------------------
     ⭐ Other Events API events (subs, follows, raids, etc.)
     You can expand this later if needed.
  --------------------------------------------------------- */
  return null;
}
