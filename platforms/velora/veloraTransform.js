// platforms/velora/veloraTransform.js
import { sanitizeHtml } from "./sanitizeNodeHTML.js";

export function transformVeloraChatMessage(msg) {
  return {
    type: "chat",
    platform: "velora",
    username: msg.displayName || msg.username,
    avatar: msg.avatarUrl || null,
    badges: msg.badges?.map((slug) => ({
      icon: `https://cdn.velora.tv/badges/${slug}.png`,
      label: slug
    })) || [],
    html: sanitizeHtml(msg.message),
    isMod: msg.isMod,
    isVip: msg.isVip,
    isSubscriber: msg.isSubscriber,
    subscriberMonths: msg.subscriberMonths || 0,
    color: msg.color || null
  };
}

export function transformVeloraEvent(payload) {
  const { event, data } = payload;

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
