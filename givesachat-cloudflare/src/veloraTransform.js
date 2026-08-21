import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { applyVeloraEmotes } from "./veloraEmotes.js";
import { resolveVeloraBadges, resolveSubscriptionBadge } from "./veloraBadges.js";

/* ---------------------------------------------------------
   1st / 2nd GIVER claim rewards.

   Kept in sync with CLAIM_REWARDS in
   public/overlay/popups/modules/claimAlerts.js — if the
   rewards are ever recreated in Velora their IDs change, and
   both lists need the new values. The title match is the
   safety net for exactly that case.
--------------------------------------------------------- */
const CLAIM_REWARD_IDS = [
  "58dd6d31-8df9-43a5-8f45-7015be44eaa2",   // First (1st)
  "f49bd3f1-ae87-4359-b15b-7c28857d036f"    // Second (2nd)
];

function isClaimReward(data = {}) {
  if (CLAIM_REWARD_IDS.includes(data.rewardId)) return true;
  return /\b(first|1st|second|2nd)\b/i.test(String(data.rewardTitle || ""));
}

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

      /* Resolved here rather than in the overlay: the channel's
         badge set is one fetch, cached for an hour, and the
         browser should never have to look anything up to render
         a message. */
      subscriptionBadge: await resolveSubscriptionBadge(msg, env),

      // Catalog badges (events etc.) resolved to asset urls. Role
      // badges are excluded — the overlay has its own artwork.
      catalogBadges: await resolveVeloraBadges(msg.badges, env),

      html: htmlMessage,

      isModerator: msg.isModerator || msg.isMod || false,
      isMod: msg.isModerator || msg.isMod || false,
      isVip: msg.isVip || false,

      /* isSub is what the docs actually document; isSubscriber
         was the only field read before, so this was always
         false. Both are accepted. */
      isSubscriber: msg.isSub || msg.isSubscriber || false,
      subTier: msg.subTier ?? null,
      subscriberMonths: msg.subMonths || msg.subscriberMonths || 0,

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
        subscriptionBadge: await resolveSubscriptionBadge(data, env),

        // Catalog badges (events etc.) resolved to asset urls. Role
        // badges are excluded — the overlay has its own artwork.
        catalogBadges: await resolveVeloraBadges(data.badges, env),

        html: htmlMessage,

        isModerator: data.isModerator || data.isMod || user.roles?.mod || false,
        isMod: data.isModerator || data.isMod || user.roles?.mod || false,
        isVip: data.isVip || user.roles?.vip || false,
        isSubscriber:
          data.isSub || data.isSubscriber || user.roles?.subscriber || false,
        subTier: data.subTier ?? null,
        subscriberMonths:
          data.subMonths || data.subscriberMonths || user.subscriberMonths || 0,

        color: data.color || user.color || null,

        effect,
        effectColor
      };
    }

    // ⭐ REWARD: channel points
    if (event === "channel.channel_points_redemption") {
      /* -----------------------------------------------------
         1st / 2nd GIVER claims are handled entirely by the
         popups overlay (see popups/modules/claimAlerts.js).
         Returning null keeps them out of the chat lane —
         without this they render there with Velora's
         {username}/{times}/{place} placeholders unsubstituted.
      ----------------------------------------------------- */
      if (isClaimReward(data)) return null;

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
            event.replace("channel.", ""),

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
