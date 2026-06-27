// platforms/velora/veloraEventsSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken, refreshVeloraToken } from "./veloraAuth.js";
import { transformVeloraEvent } from "./veloraTransform.js";

export function startVeloraEventsSocket({ onMessage }) {
  let token = getVeloraAccessToken();

  const socket = io("wss://api.velora.tv/ws/events", {
    transports: ["websocket"],
    auth: { token }
  });

  socket.on("connect_error", async (err) => {
    console.error("[VELORA EVENTS] Connect error:", err.message);

    const newToken = await refreshVeloraToken();
    if (newToken) {
      socket.auth = { token: newToken };
      socket.connect();
    }
  });

  socket.on("connected", () => {
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
}
