// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken } from "./veloraAuth.js";
import { escapeHTML } from "./escapeHTML.js";

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

        const msg = {
          type: "chat",
          platform: "velora",

          username: d.displayName,
          html: escapeHTML(d.message),
          avatar: d.avatarUrl,

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
