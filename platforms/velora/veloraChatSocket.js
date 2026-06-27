// platforms/velora/veloraChatSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken, refreshVeloraToken } from "./veloraAuth.js";
import { transformVeloraChatMessage, transformVeloraEvent } from "./veloraTransform.js";

export function startVeloraChatSocket({ channelId, onMessage }) {
  const connectSocket = async () => {
    let token = getVeloraAccessToken();
    if (!token) token = await refreshVeloraToken();

    if (!token) {
      console.error("[VELORA] No token available, cannot connect.");
      return;
    }

    const socket = io("https://api.velora.tv/chat", {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token }
    });

    socket.on("connect", () => {
      console.log("[VELORA] Connected to Velora chat/events");
      socket.emit("joinChannel", { channelId });
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA] Connect error:", err.message);
      setTimeout(connectSocket, 3000);
    });

    socket.onAny((event, payload) => {
      // Chat
      if (event === "newMessage") {
        const msg = transformVeloraChatMessage(payload);
        if (msg) onMessage(msg);
        return;
      }

      // Rewards / Events
      const evt = transformVeloraEvent(event, payload);
      if (evt) onMessage(evt);
    });

    socket.on("disconnect", () => {
      console.log("[VELORA] Disconnected");
    });
  };

  connectSocket();
}
