// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken, refreshVeloraToken } from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";

export function startVeloraEventsSocket({ onMessage }) {
  let token = getVeloraAccessToken();

  const ensureToken = async () => {
    if (!token) {
      token = await refreshVeloraToken();
    }
    return token;
  };

  const connectSocket = async () => {
    const authToken = await ensureToken();
    if (!authToken) {
      console.error("[VELORA EVENTS] No token available, cannot connect.");
      return;
    }

    const socket = io("https://api.velora.tv", {
      path: "/ws/events",
      transports: ["websocket"],
      auth: { token: authToken }
    });

    socket.on("connect_error", async (err) => {
      console.error("[VELORA EVENTS] Connect error:", err.message);

      const newToken = await refreshVeloraToken();
      if (newToken) {
        socket.auth = { token: newToken };
        socket.connect();
      }
    });

    socket.on("connect", () => {
      console.log("[VELORA EVENTS] Connected");
    });

    socket.on("event", (payload) => {
      const normalized = transformVeloraEvent(payload);
      if (normalized) onMessage(normalized);
    });

    socket.on("disconnect", (reason) => {
      console.log("[VELORA EVENTS] Disconnected:", reason);
    });

    return socket;
  };

  connectSocket();
}
