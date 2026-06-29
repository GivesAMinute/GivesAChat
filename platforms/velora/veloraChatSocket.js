// platforms/velora/veloraChatSocket.js
import { io } from "socket.io-client";

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

    socket.on("connect", () => {
      console.log("[VELORA] Connected to Velora chat");

      try {
        socket.emit("joinChannel", { channelId });
      } catch (err) {
        console.error("[VELORA] joinChannel error:", err);
      }
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA] Chat connect error:", err.message);
      socket.close();
      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ SAFE RAW PAYLOAD MODE — NO TRANSFORM, NO DEDUPE
    --------------------------------------------------------- */
    socket.on("newMessage", (payload) => {
      console.log("[VELORA RAW CHAT]", payload);

      // Send raw payload directly to overlay
      try {
        onMessage({
          type: "velora_raw",
          raw: payload
        });
      } catch (err) {
        console.error("[VELORA] raw newMessage error:", err);
      }
    });

    socket.onAny((event, payload) => {
      if (event === "newMessage") return;

      console.log(`[VELORA RAW EVENT] ${event}`, payload);

      try {
        onMessage({
          type: "velora_event_raw",
          event,
          raw: payload
        });
      } catch (err) {
        console.error(`[VELORA] raw event error (${event}):`, err);
      }
    });

    socket.on("error", (err) => {
      console.error("[VELORA] Chat socket error:", err);
    });

    socket.on("disconnect", (reason) => {
      console.log("[VELORA] Chat socket disconnected:", reason);

      try {
        socket.close();
      } catch {}

      setTimeout(connectSocket, 3000);
    });

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
