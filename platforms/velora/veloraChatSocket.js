// platforms/velora/veloraChatSocket.js
import { io } from "socket.io-client";
import {
  transformVeloraChatMessage,
  transformVeloraEvent
} from "./veloraTransform.js";
import { dedupeVeloraChat } from "./veloraDedupe.js";

export function startVeloraChatSocket({ channelId, accessToken, onMessage }) {
  if (!accessToken) {
    console.error("[VELORA] No access token provided to chat socket");
    return;
  }

  const connectSocket = () => {
    // ⭐ Correct Velora Chat WebSocket namespace
    const socket = io("wss://api.velora.tv/chat", {
      transports: ["websocket"],
      auth: { token: accessToken }
    });

    socket.on("connect", () => {
      console.log("[VELORA] Connected to Velora chat");
      socket.emit("joinChannel", { channelId });
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA] Chat connect error:", err.message);
      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ Chat WebSocket: newMessage → transform → dedupe → overlay
    --------------------------------------------------------- */
    socket.on("newMessage", (payload) => {
      const msg = transformVeloraChatMessage(payload);
      if (msg) dedupeVeloraChat(msg, onMessage);
    });

    /* ---------------------------------------------------------
       ⭐ Other chat-related events (rare but supported)
    --------------------------------------------------------- */
    socket.onAny((event, payload) => {
      if (event === "newMessage") return; // already handled

      const evt = transformVeloraEvent(event, payload);
      if (evt) onMessage(evt);
    });

    socket.on("disconnect", () => {
      console.log("[VELORA] Chat socket disconnected");
    });
  };

  connectSocket();
}
