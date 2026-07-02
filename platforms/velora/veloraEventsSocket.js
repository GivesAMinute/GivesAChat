// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken } from "./veloraAuth.js";

export function startVeloraEventsSocket({ onMessage }) {
  const connectSocket = async () => {
    let socket;

    const accessToken = await getVeloraAccessToken();
    if (!accessToken) {
      console.error("[VELORA] Cannot connect Events API — no access token");
      return setTimeout(connectSocket, 5000);
    }

    try {
      socket = io("wss://api.velora.tv/ws/events", {
        transports: ["websocket"],
        auth: { token: accessToken }
      });

      globalThis.veloraEventsSocket = socket;

    } catch (err) {
      console.error("[VELORA] Events socket init error:", err);
      return setTimeout(connectSocket, 3000);
    }

    socket.on("connected", (data) => {
      console.log("[VELORA] Connected to Events API");
      console.log("[VELORA] Channel:", data.channelUsername);
    });

    socket.on("event", async (payload) => {
      console.log(`[VELORA RAW EVENT] ${payload.event}`, payload);

      if (payload.event === "chat.message") {
        const d = payload.data;

        // ⭐ MATCH OVERLAY FORMAT EXACTLY
        const msg = {
          platform: "velora",
          user: d.displayName,
          text: d.message,
          img: d.avatarUrl,

          // badges
          badges: d.badges || [],
          subscriptionBadge: d.subscriptionBadge || null,

          isModerator: d.isModerator || false,
          isVip: d.isVip || false,
          isSubscriber: d.isSubscriber || false,
          role: d.role || null
        };

        console.log("[VELORA → OVERLAY CHAT]", msg);
        return onMessage(msg);
      }

      // other events ignored for now
    });

    socket.on("disconnect", async (reason) => {
      console.log("[VELORA] Events socket disconnected:", reason);
      try { socket.close(); } catch {}
      await getVeloraAccessToken();
      setTimeout(connectSocket, 3000);
    });
  };

  connectSocket();
}
