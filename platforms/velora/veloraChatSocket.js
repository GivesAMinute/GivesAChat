// platforms/velora/veloraChatSocket.js
import { io } from "socket.io-client";
import {
  transformVeloraChatMessage,
  transformVeloraEvent
} from "./veloraTransform.js";

export function startVeloraChatSocket({ channelId, accessToken, onMessage }) {
  if (!accessToken) {
    console.error("[VELORA] No access token provided to chat socket");
    return;
  }

  const connectSocket = () => {
    const socket = io("https://api.velora.tv/chat", {
      path: "/socket.io",
      transports: ["websocket"],
      auth: { token: accessToken }
    });

    socket.on("connect", () => {
      console.log("[VELORA] Connected to Velora chat/events");
      socket.emit("joinChannel", { channelId });
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA] Connect error:", err.message);
      setTimeout(connectSocket, 3000);
    });

    // ---------------------------------------------------------
    // ⭐ FIXED: Handle chat messages ONCE
    // ---------------------------------------------------------
    socket.on("newMessage", (payload) => {
      const msg = transformVeloraChatMessage(payload);
      if (msg) onMessage(msg);
    });

    // ---------------------------------------------------------
    // ⭐ Handle all other Velora events
    // ---------------------------------------------------------
    socket.onAny((event, payload) => {
      if (event === "newMessage") return; // prevent double-processing

      const evt = transformVeloraEvent(event, payload);
      if (evt) onMessage(evt);
    });

    socket.on("disconnect", () => {
      console.log("[VELORA] Disconnected");
    });
  };

  connectSocket();
}
