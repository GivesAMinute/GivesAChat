// platforms/velora/veloraEventsSocket.js
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
        // You may also use: query: { token: accessToken }
      });
    } catch (err) {
      console.error("[VELORA] Events API init error:", err);
      return setTimeout(connectSocket, 3000);
    }

    /* ---------------------------------------------------------
       ⭐ CONNECTED
    --------------------------------------------------------- */
    socket.on("connected", (data) => {
      console.log("[VELORA] Connected to Events API:", data?.channelUsername);
    });

    /* ---------------------------------------------------------
       ⭐ EVENT HANDLING
       Velora always sends:
       {
         event: "pointsCelebration",
         data: { ... },
         timestamp: "..."
       }
    --------------------------------------------------------- */
    socket.on("event", (payload) => {
      try {
        const evt = transformVeloraEvent(payload.event, payload);
        if (evt) onMessage(evt);
      } catch (err) {
        console.error("[VELORA] Events API event handler error:", err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ CONNECT ERROR → RECONNECT
    --------------------------------------------------------- */
    socket.on("connect_error", (err) => {
      console.error("[VELORA] Events API connect error:", err.message);
      try { socket.close(); } catch {}
      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ ERROR HANDLER
    --------------------------------------------------------- */
    socket.on("error", (err) => {
      console.error("[VELORA] Events API socket error:", err);
    });

    /* ---------------------------------------------------------
       ⭐ DISCONNECT → RECONNECT
    --------------------------------------------------------- */
    socket.on("disconnect", (reason) => {
      console.log("[VELORA] Events API disconnected:", reason);
      try { socket.close(); } catch {}
      setTimeout(connectSocket, 3000);
    });

    return socket;
  };

  return connectSocket();
}
