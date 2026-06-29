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
    let socket;

    try {
      socket = io("wss://api.velora.tv/chat", {
        transports: ["websocket"],
        auth: { token: accessToken }
      });
    } catch (err) {
      console.error("[VELORA] Chat socket init error:", err);
      return setTimeout(connectSocket, 3000);
    }

    /* ---------------------------------------------------------
       ⭐ CONNECT
    --------------------------------------------------------- */
    socket.on("connect", () => {
      console.log("[VELORA] Connected to Velora chat");

      try {
        socket.emit("joinChannel", { channelId });
      } catch (err) {
        console.error("[VELORA] joinChannel error:", err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ CONNECT ERROR → RECONNECT
    --------------------------------------------------------- */
    socket.on("connect_error", (err) => {
      console.error("[VELORA] Chat connect error:", err.message);
      socket.close();
      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ SAFE MESSAGE HANDLING + SAFE RAW LOG
    --------------------------------------------------------- */
    socket.on("newMessage", (payload) => {
      // ⭐ SAFE RAW LOG — cannot crash
      console.log("[VELORA RAW CHAT]", payload);

      try {
        const msg = transformVeloraChatMessage(payload);
        if (msg) dedupeVeloraChat(msg, onMessage);
      } catch (err) {
        console.error("[VELORA] newMessage handler error:", err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ SAFE EVENT HANDLING
    --------------------------------------------------------- */
    socket.onAny((event, payload) => {
      if (event === "newMessage") return;

      try {
        const evt = transformVeloraEvent(event, payload);
        if (evt) onMessage(evt);
      } catch (err) {
        console.error(`[VELORA] Event handler error (${event}):`, err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ ERROR HANDLER (CRITICAL)
    --------------------------------------------------------- */
    socket.on("error", (err) => {
      console.error("[VELORA] Chat socket error:", err);
    });

    /* ---------------------------------------------------------
       ⭐ DISCONNECT → RECONNECT
    --------------------------------------------------------- */
    socket.on("disconnect", (reason) => {
      console.log("[VELORA] Chat socket disconnected:", reason);

      try {
        socket.close();
      } catch {}

      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ PING/PONG (Velora uses heartbeats)
    --------------------------------------------------------- */
    socket.on("ping", () => {
      try {
        socket.emit("pong");
      } catch (err) {
        console.error("[VELORA] pong error:", err);
      }
    });
  };

  connectSocket();
}
