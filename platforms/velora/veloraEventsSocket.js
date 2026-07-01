import { io } from "socket.io-client";
import { transformVeloraEvent } from "./veloraTransform.js";

export function startVeloraEventsSocket({ accessToken, onMessage }) {
  if (!accessToken) {
    console.error("[VELORA] No access token provided to Events API");
    return null;
  }

  const connectSocket = () => {
    let socket;

    try {
      socket = io("wss://api.velora.tv/ws/events", {
        transports: ["websocket"],
        auth: { token: accessToken }
      });
    } catch (err) {
      console.error("[VELORA] Events API init error:", err);
      return setTimeout(connectSocket, 3000);
    }

    socket.on("connected", (data) => {
      console.log("[VELORA] Connected to Events API:", data?.channelUsername);
    });

    socket.on("event", (payload) => {
      try {
        const evt = transformVeloraEvent(payload.event, payload);
        if (evt) onMessage(evt);
      } catch (err) {
        console.error("[VELORA] Events API event handler error:", err);
      }
    });

    socket.on("connect_error", (err) => {
      console.error("[VELORA] Events API connect error:", err.message);
      try { socket.close(); } catch {}
      setTimeout(connectSocket, 3000);
    });

    socket.on("error", (err) => {
      console.error("[VELORA] Events API socket error:", err);
    });

    socket.on("disconnect", (reason) => {
      console.log("[VELORA] Events API disconnected:", reason);
      try { socket.close(); } catch {}
      setTimeout(connectSocket, 3000);
    });

    return socket;
  };

  return connectSocket();
}
