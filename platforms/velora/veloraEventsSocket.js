// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken } from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";

/**
 * Velora Events WebSocket
 * Endpoint: wss://api.velora.tv/ws/events
 */

export function startVeloraEventsSocket({ onEvent }) {
  const connectSocket = async () => {
    let socket;

    const accessToken = await getVeloraAccessToken();
    if (!accessToken) {
      console.error("[VELORA EVENTS] Cannot connect — no access token");
      return setTimeout(connectSocket, 5000);
    }

    try {
      socket = io("wss://api.velora.tv/ws/events", {
        transports: ["websocket"],
        auth: { token: accessToken }
      });
    } catch (err) {
      console.error("[VELORA EVENTS] Init error:", err);
      return setTimeout(connectSocket, 3000);
    }

    socket.on("connected", (data) => {
      console.log("[VELORA EVENTS] Connected to Events API");
      console.log("[VELORA EVENTS] Channel:", data.channelUsername);
    });

    socket.on("event", (payload) => {
      console.log("[VELORA RAW EVENT]", payload);

      try {
        const evt = transformVeloraEvent(payload.event, payload);
        if (evt) onEvent(evt);
      } catch (err) {
        console.error("[VELORA EVENTS] Handler error:", err);
      }
    });

    socket.on("error", (err) => {
      console.error("[VELORA EVENTS] Socket error:", err.message || err);
    });

    socket.on("connect_error", async (err) => {
      console.error("[VELORA EVENTS] Connect error:", err.message);

      try {
        socket.close();
      } catch {}

      await getVeloraAccessToken();
      setTimeout(connectSocket, 3000);
    });

    socket.on("disconnect", async (reason) => {
      console.log("[VELORA EVENTS] Disconnected:", reason);

      try {
        socket.close();
      } catch {}

      await getVeloraAccessToken();
      setTimeout(connectSocket, 3000);
    });

    socket.on("ping", () => {
      try {
        socket.emit("pong");
      } catch (err) {
        console.error("[VELORA EVENTS] pong error:", err);
      }
    });
  };

  connectSocket();
}
