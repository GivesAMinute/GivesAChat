import { sanitizeHtml } from "./sanitizeNodeHTML.js";

/* ---------------------------------------------------------
   ⭐ Velora badge map (REAL Velora icons)
--------------------------------------------------------- */
const VELORA_BADGE_MAP = {
  broadcaster: "/velora-badges/StreamerBroadcasterBadge.png",
  moderator: "/velora-badges/ModeratorBadge.png",
  vip: "/velora-badges/VIPBadge.png",
  staff: "/velora-badges/StaffBadge.png",
  founder: "/velora-badges/FounderBadge.png",
  bot: "/velora-badges/BotBadge.png"
};

/* ---------------------------------------------------------
   ⭐ Transform Velora Chat WebSocket messages (newMessage)
   Matches REAL payload shape from your logs.
--------------------------------------------------------- */
export function transformVeloraChatMessage(msg) {
  try {
    if (!msg) return null;

    /* ---------------------------------------------------------
       ⭐ Build badge list
    --------------------------------------------------------- */
    const badges = [];

    // Slug badges (broadcaster, moderator, vip, etc.)
    if (Array.isArray(msg.badges)) {
      for (const slug of msg.badges) {
        // Subscriber slug → handled separately
        if (slug === "subscriber") continue;

        const icon = VELORA_BADGE_MAP[slug];
        if (icon) {
          badges.push({
            icon,
            label: slug
          });
        }
      }
    }

    // Subscriber badge (special object)
    if (msg.subscriptionBadge?.staticAssetUrl) {
      badges.push({
        icon: msg.subscriptionBadge.staticAssetUrl,
        label: msg.subscriptionBadge.label || "Subscriber",
        months: msg.subscriptionBadge.tenureMonths || 0
      });
    }

    return {
      type: "chat",
      platform: "velora",

      // Dedupe key
      messageId: msg.id || msg.messageId || null,

      // User identity
      username: msg.displayName || msg.username || "Unknown",
      avatar: msg.avatarUrl || null,

      // All badges combined
      badges,

      // Message content
      html: sanitizeHtml(msg.message || ""),

      // User flags
      isMod: msg.isModerator || false,
      isVip: msg.isVip || false,
      isSubscriber: msg.isSubscriber || false,

      // Accent color
      color: msg.accentColor || null
    };
  } catch (err) {
    console.error("[VELORA] transformVeloraChatMessage error:", err);
    return null;
  }
}

/* ---------------------------------------------------------
   ⭐ Transform Velora Events API messages (event: "chat.message")
   (unchanged — Events API uses a different schema)
--------------------------------------------------------- */
export function transformVeloraEvent(event, payload) {
  try {
    if (!payload || !payload.data) return null;

    const data = payload.data;
    const user = data.user || {};

    if (event === "chat.message") {
      return {
        type: "chat",
        platform: "velora",

        messageId: data.messageId || data.id || null,
        username: user.displayName || user.username || null,
        avatar: user.avatar || null,

        badges: Array.isArray(user.badges)
          ? user.badges.map((slug) => ({
              icon: VELORA_BADGE_MAP[slug] ||
                    `https://cdn.velora.tv/badges/${slug}.png`,
              label: slug
            }))
          : [],

        html: sanitizeHtml(data.content?.html || ""),

        isMod: user.roles?.mod || false,
        isVip: user.roles?.vip || false,
        isSubscriber: user.roles?.subscriber || false,
        subscriberMonths: user.subscriberMonths || 0,

        color: user.color || null,

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

    return null;
  } catch (err) {
    console.error("[VELORA] transformVeloraEvent error:", err);
    return null;
  }
}
