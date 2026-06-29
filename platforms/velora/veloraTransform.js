import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   ⭐ Transform Velora Chat WebSocket messages (newMessage)
   Schema: https://api.velora.tv/chat
--------------------------------------------------------- */
export function transformVeloraChatMessage(msg) {
  try {
    if (!msg) return null;

    // Velora Chat WS schema:
    // {
    //   id,
    //   sender: { username, displayName, avatar, badges, channelRole, ... },
    //   content: { text, html },
    //   replyTo: { ... }
    // }

    const sender = msg.sender || {};
    const content = msg.content || {};

    return {
      type: "chat",
      platform: "velora",

      // Dedupe key
      messageId: msg.id || msg.messageId || null,

      // User identity
      username: sender.displayName || sender.username || null,
      avatar: sender.avatarUrl || sender.avatar || null,

      // Badges
      badges: Array.isArray(sender.badges)
        ? sender.badges.map((slug) => ({
            icon: `https://cdn.velora.tv/badges/${slug}.png`,
            label: slug
          }))
        : [],

      // Message content (Chat WS uses text or html)
      html: sanitizeHtml(
        content.html ||
          content.text ||
          msg.message || // fallback for older schema
          ""
      ),

      // User flags (channelRole is authoritative)
      isMod: sender.channelRole === "mod",
      isVip: sender.channelRole === "vip",
      isSubscriber: sender.channelRole === "subscriber",
      subscriberMonths: sender.subscriberMonths || 0,

      // Accent color
      color: sender.color || null
    };
  } catch (err) {
    console.error("[VELORA] transformVeloraChatMessage error:", err);
    return null;
  }
}

/* ---------------------------------------------------------
   ⭐ Transform Velora Events API messages (event: "chat.message")
   Schema: https://api.velora.tv/ws/events
--------------------------------------------------------- */
export function transformVeloraEvent(event, payload) {
  try {
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

        messageId: data.messageId || data.id || null,
        username: user.displayName || user.username || null,
        avatar: user.avatar || null,

        badges: Array.isArray(user.badges)
          ? user.badges.map((slug) => ({
              icon: `https://cdn.velora.tv/badges/${slug}.png`,
              label: slug
            }))
          : [],

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

        rewardIcon: data.rewardIcon || null,
        rewardColor: data.rewardColor || null,
        cardDesign: data.cardDesign || null
      };
    }

    /* ---------------------------------------------------------
       ⭐ Other Events API events (subs, follows, raids, etc.)
    --------------------------------------------------------- */
    return null;
  } catch (err) {
    console.error("[VELORA] transformVeloraEvent error:", err);
    return null;
  }
}
