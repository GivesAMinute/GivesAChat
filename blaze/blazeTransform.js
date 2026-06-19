// backend/blaze/blazeTransform.js
export function extractMessage(msg) {
  if (msg.message) return msg.message;
  if (msg.content) return msg.content;
  if (msg.text) return msg.text;

  const parts = msg.parts || msg.fragments || msg.contentParts || [];
  return parts
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "emote") return `<img src="${p.url}" class="emote" />`;
      if (p.type === "sticker") return `<img src="${p.url}" class="sticker" />`;
      return "";
    })
    .join("");
}

export function normalizeSender(msg) {
  let sender = {};

  try {
    const raw = JSON.stringify(msg);
    const match = raw.match(/"sender":\s*({[^}]+})/);
    if (match) sender = JSON.parse(match[1]);
  } catch {}

  sender =
    sender ||
    msg.sender?.sender ||
    msg.sender?.user ||
    msg.sender ||
    msg.user ||
    msg.author ||
    {};

  return sender;
}

export function transformBlazeMessage(msg) {
  const sender = normalizeSender(msg);
  const roles = sender.roles || [];
  const CHANNEL_OWNER_ID = process.env.BLAZE_OWNER_ID;

  const badges = [];

  if (roles.includes("moderator"))
    badges.push("https://cdn.blaze.stream/badges/mod.svg");

  if (roles.includes("og"))
    badges.push("https://cdn.blaze.stream/badges/og.svg");

  if (roles.includes("vip"))
    badges.push("https://cdn.blaze.stream/badges/vip.svg");

  if (String(sender.id) === String(CHANNEL_OWNER_ID))
    badges.push("https://cdn.blaze.stream/badges/streamer.svg");

  return {
    platform: "blaze",
    id: msg.id,
    username: sender.displayName || sender.username || sender.slug || "Unknown",
    avatar: sender.avatarUrl || null,
    html: extractMessage(msg),

    isStreamer: String(sender.id) === String(CHANNEL_OWNER_ID),
    isMod: roles.includes("moderator"),
    isOG: roles.includes("og"),
    isVIP: roles.includes("vip"),

    badges,
    timestamp: msg.timestamp || msg.createdAt || Date.now()
  };
}
