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
