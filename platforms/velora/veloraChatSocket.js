import { io } from "socket.io-client";
import { getVeloraAccessToken, refreshVeloraToken } from "./veloraAuth.js";
import { transformVeloraChatMessage } from "./veloraTransform.js";

export function startVeloraChatSocket({ channelId, onMessage }) {
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
      console.error("[VELORA CHAT] No token available, cannot connect.");
      return;
    }

    const socket = io("https://api.velora.tv", {
      path: "/chat",
      transports: ["websocket"],
      auth: { token: authToken }
    });

    socket.on("connect_error", async (err) => {
      console.error("[VELORA CHAT] Connect error:", err.message);

      const newToken = await refreshVeloraToken();
      if (newToken) {
        socket.auth = { token: newToken };
        socket.connect();
      }
    });

    socket.on("connect", () => {
      console.log("[VELORA CHAT] Connected");
      socket.emit("joinChannel", { channelId });
    });

    socket.on("newMessage", (payload) => {
      const normalized = transformVeloraChatMessage(payload);
      onMessage(normalized);
    });

    socket.on("disconnect", (reason) => {
      console.log("[VELORA CHAT] Disconnected:", reason);
    });

    return socket;
  };

  connectSocket();
}
