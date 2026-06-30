// platforms/velora/veloraEventsSocket.js
import WebSocket from "ws";
import { transformVeloraEvent } from "./veloraTransform.js";

export function startVeloraEventsSocket({ accessToken, onMessage }) {
  if (!accessToken) {
    console.error("[VELORA] No access token provided to Events API");
    return null;
  }

  const connectSocket = () => {
    let socket;

    try {
      socket = new WebSocket(`wss://api.velora.tv/ws/events?token=${accessToken}`);
    } catch (err) {
      console.error("[VELORA] Events API init error:", err);
      return setTimeout(connectSocket, 3000);
    }

    /* ---------------------------------------------------------
       ⭐ CONNECT
    --------------------------------------------------------- */
    socket.on("open", () => {
      console.log("[VELORA] Connected to Events API");
    });

    /* ---------------------------------------------------------
       ⭐ MESSAGE HANDLING (CORRECT)
    --------------------------------------------------------- */
    socket.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw);

        // Velora sends: { event: "pointsCelebration", data: {...} }
        const { event, data } = payload;

        const evt = transformVeloraEvent(event, data);
        if (evt) onMessage(evt);
      } catch (err) {
        console.error("[VELORA] Events API message error:", err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ ERROR → RECONNECT
    --------------------------------------------------------- */
    socket.on("error", (err) => {
      console.error("[VELORA] Events API socket error:", err);
      try { socket.close(); } catch {}
    });

    /* ---------------------------------------------------------
       ⭐ DISCONNECT → RECONNECT
    --------------------------------------------------------- */
    socket.on("close", () => {
      console.log("[VELORA] Events API disconnected");
      setTimeout(connectSocket, 3000);
    });

    return socket;
  };

  return connectSocket();
}
