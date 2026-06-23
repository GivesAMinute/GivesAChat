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

  // ⭐ This is where Blaze sends the sessionId
  socket.on("session_welcome", async ({ sessionId }) => {
    console.log("[BLAZE] Session ID:", sessionId); // ⭐ Added so you can see it

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
          "https://blaze.stream/v1/events/subscriptions",
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
        console.log(`[BLAZE] Subscribed to: ${type}`);
      } catch (err) {
        console.error(
          "[BLAZE] Subscription error:",
          type,
          err.response?.data || err.message
        );
      }
    }
  });

  // ⭐ Blaze EventSub notifications
  socket.on("eventsub", ({ metadata, payload }) => {
    if (!metadata || !metadata.subscriptionType) return;

    if (metadata.subscriptionType === "channel.chat.message") {
      const sender = payload.user || {};
      const roles = sender.roles || [];

      const badges = [];

      if (roles.includes("moderator"))
        badges.push("https://cdn.blaze.stream/badges/mod.svg");

      if (roles.includes("og"))
        badges.push("https://cdn