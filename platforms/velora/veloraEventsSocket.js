// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken } from "./veloraAuth.js";

/**
 * Velora Events WebSocket
 * Endpoint: wss://api.velora.tv/ws/events
 * Emits unified events: chat.message, channel_points_redemption,
 * volts, subs, raids, stickers, celebrations, etc.
 */

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

      // Keep socket alive globally
      globalThis.veloraEventsSocket = socket;

    } catch (err) {
      console.error("[VELORA] Events socket init error:", err);
      return setTimeout(connectSocket, 3000);
    }

    /* ---------------------------------------------------------
       ⭐ CONNECTED
    --------------------------------------------------------- */
    socket.on("connected", (data) => {
      console.log("[VELORA] Connected to Events API");
      console.log("[VELORA] Channel:", data.channelUsername);
    });

    /* ---------------------------------------------------------
       ⭐ EVENT HANDLING
    --------------------------------------------------------- */
    socket.on("event", async (payload) => {
      console.log(`[VELORA RAW EVENT] ${payload.event}`, payload);

      // ⭐ Handle chat messages directly (overlay format)
      if (payload.event === "chat.message") {
        const d = payload.data;

        const msg = {
          type: "chat",                       // ⭐ REQUIRED FOR OVERLAY
          platform: "velora",

          username: d.displayName,            // overlay uses payload.username
          html: d.message,                    // overlay uses payload.html
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

      // ⭐ Ignore other events for now (reward cards handled elsewhere)
    });

    /* ---------------------------------------------------------
       ⭐ ERROR
    --------------------------------------------------------- */
    socket.on("error", (err) => {
      console.error("[VELORA] Events socket error:", err);
    });

    /* ---------------------------------------------------------
       ⭐ DISCONNECT → RECONNECT
    --------------------------------------------------------- */
    socket.on("disconnect", async (reason) => {
      console.log("[VELORA] Events socket disconnected:", reason);

      try {
        socket.close();
      } catch {}

      await getVeloraAccessToken();
      setTimeout(connectSocket, 3000);
    });
  };

  connectSocket();
}
