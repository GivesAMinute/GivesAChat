// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { transformVeloraEvent } from "./veloraTransform.js";

export function startVeloraEventsSocket({ accessToken, onMessage }) {
  if (!accessToken) {
    console.error("[VELORA] No access token provided to Events API");
    return;
  }

  const connectSocket = () => {
    const socket = io("wss://api.velora.tv/ws/events", {
      transports: ["websocket"],
      auth: { token: accessToken }
    });

    socket.on("connected", (data) => {
      console.log("[VELORA] Connected to Events API:", data.channelUsername);
    });

    socket.on("event", (payload) => {
      const evt = transformVeloraEvent(payload.event, payload);
      if (evt) onMessage(evt);
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA] Events API connect error:", err.message);
      setTimeout(connectSocket, 3000);
    });

    socket.on("disconnect", (reason) => {
      console.log("[VELORA] Events API disconnected:", reason);
    });
  };

  connectSocket();
}
