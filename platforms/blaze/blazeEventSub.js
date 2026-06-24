// platforms/blaze/blazeEventSub.js
import axios from "axios";
import { io } from "socket.io-client";
import { extractMessage } from "./blazeTransform.js";
import { getBlazeAccessToken, refreshBlazeToken } from "./blazeAuth.js";

export function startBlazeEventSub(broadcast) {
  const channelId = process.env.BLAZE_CHANNEL_ID;
  const clientId = process.env.BLAZE_CLIENT_ID;

  let currentSessionId = null;

  function buildSocket() {
    return io("https://blaze.stream", {
      path: "/ws",
      transports: ["websocket"],
      auth: {
        token: getBlazeAccessToken(),
        "client-id": clientId
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000
    });
  }

  let socket = buildSocket();

  // -----------------------------
  // AUTO-SUBSCRIBE FUNCTION
  // -----------------------------
  async function subscribeToAll(sessionId) {
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
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
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
                Authorization: `Bearer ${getBlazeAccessToken()}`,
                "Content-Type": "application/json"
              }
            }
          );

          console.log(`[BLAZE] Subscribed to: ${type}`);
          break;
        } catch (err) {
          attempts++;

          // 🔥 Auto-refresh on 401
          if (err.response?.status === 401) {
            console.log("[BLAZE] 401 during subscription — refreshing token...");
            await refreshBlazeToken();
            continue; // retry immediately
          }

          const msg = err.response?.data || err.message;
          console.error(`[BLAZE] Subscription error (${type}) attempt ${attempts}:`, msg);

          if (attempts >= maxAttempts) {
            console.error(`[BLAZE] FAILED to subscribe to ${type} after ${maxAttempts} attempts`);
          } else {
            await new Promise((res) => setTimeout(res, 1000 * attempts));
          }
        }
      }
    }
  }

  // -----------------------------
  // SESSION WELCOME
  // -----------------------------
  socket.on("session_welcome", async ({ sessionId }) => {
    currentSessionId = sessionId;
    console.log("[BLAZE] Session ID:", sessionId);

    await subscribeToAll(sessionId);
  });

  // -----------------------------
  // AUTO-RESUBSCRIBE ON RECONNECT
  // -----------------------------
  socket.on("reconnect", () => {
    console.log("[BLAZE] Reconnected — waiting for new session_welcome...");
  });

  socket.on("reconnect_attempt", (n) => {
    console.log(`[BLAZE] Reconnect attempt ${n}`);
  });

  socket.on("connect_error", async (err) => {
    console.error("[BLAZE] Socket connection error:", err.message);

    // 🔥 Auto-refresh on 401
    if (err.message.includes("401")) {
      console.log("[BLAZE] 401 on socket — refreshing token...");
      await refreshBlazeToken();

      console.log("[BLAZE] Rebuilding socket with new token...");
      socket = buildSocket();
    }
  });

  // -----------------------------
  // EVENT HANDLING
  // -----------------------------
  socket.on("eventsub", ({ metadata, payload }) => {
    if (!metadata || !metadata.subscriptionType) return;

    if (metadata.subscriptionType === "channel.chat.message") {
      const sender = payload.user || {};
      const roles = sender.roles || [];

      const badges = [];

      if (roles.includes("moderator")) {
        badges.push("https://cdn.blaze.stream/badges/mod.svg");
      }

      if (roles.includes("og")) {
        badges.push("https://cdn.blaze.stream/badges/og.svg");
      }

      if (roles.includes("vip")) {
        badges.push("https://cdn.blaze.stream/badges/vip.svg");
      }

      if (sender.isOwner === true) {
        badges.push("https://cdn.blaze.stream/badges/streamer.svg");
      }

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
