import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { applyVeloraEmotes } from "./veloraEmotes.js";

/**
 * Velora WebSocket Chat Transformer
 */
export async function transformVeloraChatMessage(msg, env) {
  try {
    if (!msg) return null;

    const rawMessage =
      msg.message ||
      msg.html ||
      msg.text ||
      "";

    const htmlMessage = sanitizeHtml(
      await applyVeloraEmotes(rawMessage, env)
    );

    const effect =
      msg.messageEffects?.effect ||
      msg.messageEffects?.name ||
      msg.effect ||
      null;

    const effectColor =
      msg.messageEffects?.color ||
      msg.effectColor ||
      null;

    return {
      type: "chat",
      platform: "velora",

      messageId: msg.messageId || msg.id || null,
      username: msg.username || msg.displayName || "Unknown",
      avatar: msg.avatar || msg.avatarUrl || null,

      badges: Array.isArray(msg.badges) ? msg.badges : [],
      subscriptionBadge: msg.subscriptionBadge || null,

      html: htmlMessage,

      isModerator: msg.isModerator || msg.isMod || false,
      isMod: msg.isModerator || msg.isMod || false,
      isVip: msg.isVip || false,
      isSubscriber: msg.isSubscriber || false,
      subscriberMonths: msg.subscriberMonths || 0,

      color: msg.color || msg.accentColor || null,

      effect,
      effectColor
    };
  } catch (err) {
    console.error("[VELORA] transformVeloraChatMessage error:", err);
    return null;
  }
}

/**
 * Velora Webhook Event Transformer
 */
export async function transformVeloraEvent(event, payload, env) {
  try {
    if (!payload || !payload.data) return null;

    const data = payload.data;
    const user = data.user || {};

    // ⭐ CHAT
    if (event === "chat.message") {
      const rawMessage =
        data.message ||
        data.html ||
        data.text ||
        "";

      const htmlMessage = sanitizeHtml(
        await applyVeloraEmotes(rawMessage, env)
      );

      const effect =
        data.messageEffects?.effect ||
        data.messageEffects?.name ||
        data.effect ||
        null;

      const effectColor =
        data.messageEffects?.color ||
        data.effectColor ||
        null;

      return {
        type: "chat",
        platform: "velora",
        messageId: data.messageId || data.id || null,
        username: data.displayName || data.username || null,
        avatar: data.avatarUrl || user.avatar || null,

        badges: Array.isArray(data.badges) ? data.badges : [],
        subscriptionBadge: data.subscriptionBadge || null,

        html: htmlMessage,

        isModerator: data.isModerator || data.isMod || user.roles?.mod || false,
        isMod: data.isModerator || data.isMod || user.roles?.mod || false,
        isVip: data.isVip || user.roles?.vip || false,
        isSubscriber: data.isSubscriber || user.roles?.subscriber || false,
        subscriberMonths:
          data.subscriberMonths || user.subscriberMonths || 0,

        color: data.color || user.color || null,

        effect,
        effectColor
      };
    }

    // ⭐ REWARD: channel points
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

    // ⭐ REWARD: points celebration
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

    // ⭐ STREAM ALERTS — FIXED (restores stripped‑back chat card)
    const alertEvents = [
      "channel.follow",
      "channel.subscribe",
      "channel.subscription.gift",
      "channel.volts",
      "channel.raid",
      "channel.stream_alert"
    ];

    if (alertEvents.includes(event)) {
      return {
        type: "velora_system",
        event: "channel.stream_alert",
        platform: "velora",
        data: {
          alertType:
            data.alertType ||
            data.type ||
            event.replace("channel.", ""), // normalize

          displayName: data.displayName || data.username || null,
          username: data.username || data.displayName || null,

          count: data.count || data.amount || data.total || null,
          viewers: data.viewers || null,

          message: data.message || null,
          customSoundUrl: data.customSoundUrl || null
        }
      };
    }

    return null;
  } catch (err) {
    console.error("[VELORA] transformVeloraEvent error:", err);
    return null;
  }
}

/**
 * ⭐ Beam Event Transformer (updated to feed overlay html)
 */
export function transformBeamEvent(raw) {
  const text = raw?.contents?.text || "";

  return {
    type: "chat",
    platform: "beam",

    username: raw?.sender?.name || "Unknown",
    avatar: raw?.sender?.avatar || null,

    html: text,

    sticker: raw?.sticker || raw?.contents?.sticker || null,

    raw
  };
}
