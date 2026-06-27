// veloraChatSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken, refreshVeloraToken } from "./veloraAuth.js";
import { transformVeloraChatMessage } from "./veloraTransform.js";

export function startVeloraChatSocket({ channelId, onMessage }) {
  const connectSocket = async () => {
    let token = getVeloraAccessToken();
    if (!token) token = await refreshVeloraToken();

    if (!token) {
      console.error("[VELORA CHAT] No token available, cannot connect.");
      return;
    }

    const socket = io("https://api.velora.tv", {
      path: "/chat/socket",
      transports: ["websocket"],
      auth: { token }
    });

    socket.on("connect", () => {
      console.log("[VELORA CHAT] Connected");
      socket.emit("joinChannel", { channelId });
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA CHAT] Connect error:", err.message);
      setTimeout(connectSocket, 3000); // retry WITHOUT refreshing
    });

    socket.on("newMessage", (payload) => {
      const normalized = transformVeloraChatMessage(payload);
      onMessage(normalized);
    });

    socket.on("disconnect", () => {
      console.log("[VELORA CHAT] Disconnected");
    });
  };

  connectSocket();
}
