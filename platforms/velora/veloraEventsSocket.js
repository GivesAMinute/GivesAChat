// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken } from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";

/**
 * Velora Events WebSocket
 * Endpoint: wss://api.velora.tv/ws/events
 * Emits unified events: chat.message, channel_points_redemption, volts, subs, etc.
 */

export function startVeloraEventsSocket({ onMessage }) {
  const connectSocket = async () => {
    let socket;

    const accessToken = await getVeloraAccessToken();
    if (!accessToken) {
      console.error("[VELORA] Cannot connect events — no access token");
      return setTimeout(connectSocket, 5000);
    }

    try {
      socket = io("wss://api.velora.tv/ws/events", {
        transports: ["websocket"],
        auth: { token: accessToken }
      });
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

      try {
        const evt = await transformVeloraEvent(payload.event, payload);
        if (evt) onMessage(evt);
      } catch (err) {
        console.error(`[VELORA] Event handler error (${payload.event}):`, err);
      }
    });

    socket.on("error", (err) => {
      console.error("[VELORA] Events socket error:", err);
    });

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
