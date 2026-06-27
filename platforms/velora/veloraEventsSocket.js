// veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken, refreshVeloraToken } from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";

export function startVeloraEventsSocket({ onMessage }) {
  const connectSocket = async () => {
    let token = getVeloraAccessToken();
    if (!token) token = await refreshVeloraToken();

    if (!token) {
      console.error("[VELORA EVENTS] No token available, cannot connect.");
      return;
    }

    const socket = io("https://api.velora.tv", {
      path: "/events/socket",
      transports: ["websocket"],
      auth: { token }
    });

    socket.on("connect", () => {
      console.log("[VELORA EVENTS] Connected");
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA EVENTS] Connect error:", err.message);
      setTimeout(connectSocket, 3000); // retry WITHOUT refreshing
    });

    socket.on("event", (payload) => {
      const normalized = transformVeloraEvent(payload);
      if (normalized) onMessage(normalized);
    });

    socket.on("disconnect", () => {
      console.log("[VELORA EVENTS] Disconnected");
    });
  };

  connectSocket();
}
