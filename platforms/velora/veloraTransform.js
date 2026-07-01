import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { applyVeloraEmotes } from "./veloraEmotes.js";

/* ---------------------------------------------------------
   ⭐ Velora badge map
--------------------------------------------------------- */
const VELORA_BADGE_MAP = {
  broadcaster: "https://velora.tv/velora-badges/StreamerBroadcasterBadge.png",
  moderator: "https://velora.tv/velora-badges/ModeratorBadge.png",
  vip: "https://velora.tv/velora-badges/VIPBadge.png",
  staff: "https://velora.tv/velora-badges/StaffBadge.png",
  founder: "https://velora.tv/velora-badges/FounderBadge.png",
  bot: "https://velora.tv/velora-badges/BotBadge.png"
};

/* ---------------------------------------------------------
   ⭐ Transform Velora Chat WebSocket messages (if you still use it)
--------------------------------------------------------- */
export async function transformVeloraChatMessage(msg) {
  try {
    if (!msg) return null;

    // Points celebration via chat socket metadata (if present)
    if (msg.metadata?.card?.type === "points-celebration") {
      const payload = msg.metadata.card.payload;
      const cd = payload.cardDesign || {};
      const bg = cd.background || {};
      const iconCfg = cd.icon || {};

      const gradientColors =
        Array.isArray(bg.colors) && bg.colors.length
          ? bg.colors
          : [bg.color || "#ff0055", "#0066ff"];

      const rewardIcon =
        iconCfg.customIconUrl ||
        iconCfg.emoteUrl ||
        payload.itemIconUrl ||
        null;

      return {
        type: "reward",
        platform: "velora",
        redemptionId: payload.id,
        rewardName: payload.itemName,
        rewardCost: payload.cost,
        rewardId: payload.itemId,
        username: payload.displayName || payload.username,
        avatar: payload.avatarUrl || null,
        userInput: payload.message || null,
        redeemedAt: payload.createdAt || null,
        rewardIcon,
        rewardColor: gradientColors[0],
        cardDesign: payload.cardDesign || null
      };
    }

    // Normal chat message (chat socket)
    const badges = [];

    if (Array.isArray(msg.badges)) {
      for (const slug of msg.badges) {
        if (slug === "subscriber") continue;
        const icon = VELORA_BADGE_MAP[slug];
        if (icon) badges.push({ icon, label: slug });
      }
    }

    if (msg.subscriptionBadge?.staticAssetUrl) {
      badges.push({
        icon: msg.subscriptionBadge.staticAssetUrl,
        label: msg.subscriptionBadge.label || "Subscriber",
        months: msg.subscriptionBadge.tenureMonths || 0
      });
    }

    const htmlMessage = sanitizeHtml(
      await applyVeloraEmotes(msg.message || "")
    );

    return {
      type: "chat",
      platform: "velora",
      messageId: msg.id || msg.messageId || null,
      username: msg.displayName || msg.username || "Unknown",
      avatar: msg.avatarUrl || null,
      badges,
      html: htmlMessage,
      isMod: msg.isModerator || false,
      isVip: msg.isVip || false,
      isSubscriber: msg.isSubscriber || false,
      color: msg.accentColor || null
    };
  } catch (err) {
    console.error("[VELORA] transformVeloraChatMessage error:", err);
    return null;
  }
}

/* ---------------------------------------------------------
   ⭐ Transform Velora Events API messages (canonical)
--------------------------------------------------------- */
export async function transformVeloraEvent(event, payload) {
  try {
    if (!payload || !payload.data) return null;

    const data = payload.data;
    const user = data.user || {};

    /* ----------------- Chat message (Events API) ----------------- */
    if (event === "chat.message") {
      const htmlMessage = sanitizeHtml(
        await applyVeloraEmotes(data.message || "")
      );

      const badges =
        Array.isArray(data.badges) && data.badges.length
          ? data.badges.map((slug) => ({
              icon:
                VELORA_BADGE_MAP[slug] ||
                `https://cdn.velora.tv/badges/${slug}.png`,
              label: slug
            }))
          : [];

      return {
        type: "chat",
        platform: "velora",
        messageId: data.messageId || data.id || null,
        username: data.displayName || data.username || null,
        avatar: data.avatarUrl || user.avatar || null,
        badges,
        html: htmlMessage,
        isMod: data.isMod || user.roles?.mod || false,
        isVip: data.isVip || user.roles?.vip || false,
        isSubscriber: data.isSubscriber || user.roles?.subscriber || false,
        subscriberMonths:
          data.subscriberMonths || user.subscriberMonths || 0,
        color: data.color || user.color || null
      };
    }

    /* ----------------- Legacy channel points redemption ----------------- */
    if (event === "channel.channel_points_redemption") {
      return {
        type: "reward",
        platform: "velora",
        redemptionId: data.redemptionId,
        rewardName: data.rewardTitle,
        rewardCost: data.rewardCost,
        rewardId: data.rewardId,
        username: data.displayName || data.username,
        avatar: data.avatarUrl || null,
        userInput: data.userInput || null,
        redeemedAt: data.redeemedAt || null,
        rewardIcon: data.rewardIcon || null,
        rewardColor: data.rewardColor || null,
        cardDesign: data.cardDesign || null
      };
    }

    /* ----------------- Points Celebration (new cards) ----------------- */
    if (event === "pointsCelebration") {
      const cd = data.cardDesign || {};
      const bg = cd.background || {};
      const iconCfg = cd.icon || {};

      const gradientColors =
        Array.isArray(bg.colors) && bg.colors.length
          ? bg.colors
          : [bg.color || "#ff0055", "#0066ff"];

      const rewardIcon =
        iconCfg.customIconUrl ||
        iconCfg.emoteUrl ||
        data.itemIconUrl ||
        null;

      return {
        type: "reward",
        platform: "velora",
        redemptionId: data.id,
        rewardName: data.itemName,
        rewardCost: data.cost,
        rewardId: data.itemId,
        username: data.displayName || data.username,
        avatar: data.avatarUrl || null,
        userInput: data.message || null,
        redeemedAt: data.createdAt || null,
        rewardIcon,
        rewardColor: gradientColors[0],
        cardDesign: data.cardDesign || null
      };
    }

    return null;
  } catch (err) {
    console.error("[VELORA] transformVeloraEvent error:", err);
    return null;
  }
}
