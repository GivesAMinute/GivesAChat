// backend/blaze/blazeEventSub.js
import axios from "axios";
import { io } from "socket.io-client";
import { extractMessage } from "./blazeTransform.js";

export function startBlazeEventSub(broadcast) {
  const channelId = process.env.BLAZE_CHANNEL_ID;
  const clientId = process.env.BLAZE_CLIENT_ID;
  const accessToken = process.env.BLAZE_ACCESS_TOKEN;

  const socket = io("https://blaze.stream", {
    path: "/ws",
    transports: ["websocket"],
    auth: {
      token: accessToken,
      "client-id": clientId
    }
  });

  socket.on("session_welcome", async ({ sessionId }) => {
    const subs = [
      "channel.chat.message",
      "channel.chat.message_delete",
      "channel.chat.clear",
      "channel.ban",
      "channel.unban",
      "channel.follow",
      "channel.subscribe",
      "channel.subscription.gift",
      "channel.raid"
    ];

    for (const type of subs) {
      try {
        await axios.post(
          "https://api.blaze.stream/v1/events/subscriptions",
          {
            type,
            sessionId,
            condition: { channelId }
          },
          {
            headers: {
              "client-id": clientId,
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            }
          }
        );
      } catch (err) {
        console.error("[BLAZE] Subscription error:", type, err.response?.data || err.message);
      }
    }
  });

  socket.on("eventsub", ({ metadata, payload }) => {
    if (!metadata || !metadata.subscriptionType) return;

    if (metadata.subscriptionType === "channel.chat.message") {
      const sender = payload.user || {};
      const roles = sender.roles || [];

      const badges = [];

      if (roles.includes("moderator"))
        badges.push("https://cdn.blaze.stream/badges/mod.svg");

      if (roles.includes("og"))
        badges.push("https://cdn.blaze.stream/badges/og.svg");

      if (roles.includes("vip"))
        badges.push("https://cdn.blaze.stream/badges/vip.svg");

      if (sender.isOwner === true)
        badges.push("https://cdn.blaze.stream/badges/streamer.svg");

      broadcast({
        platform: "blaze",
        id: payload.id,
        username: sender.displayName || sender.username,
        avatar: sender.avatarUrl,
        html: extractMessage(payload),
        badges,
        timestamp: payload.createdAt
      });
    }
  });
}
