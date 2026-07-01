// platforms/velora/veloraChatSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken } from "./veloraAuth.js";
import {
  transformVeloraChatMessage,
  transformVeloraEvent
} from "./veloraTransform.js";
import { dedupeVeloraChat } from "./veloraDedupe.js";

/**
 * Velora Chat WebSocket (Client Credentials OAuth)
 *
 * - Fetches a fresh access token on startup
 * - Re-fetches token on reconnect
 * - Joins channel after connect
 * - Handles chat + events
 * - Dedupes messages
 */

export function startVeloraChatSocket({ channelId, onMessage }) {
  const connectSocket = async () => {
    let socket;

    // Always fetch a fresh access token before connecting
    const accessToken = await getVeloraAccessToken();

    if (!accessToken) {
      console.error("[VELORA] Cannot connect — no access token available");
      return setTimeout(connectSocket, 5000);
    }

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
    socket.on("connect_error", async (err) => {
      console.error("[VELORA] Chat connect error:", err.message);

      try {
        socket.close();
      } catch {}

      // Fetch a new token on reconnect
      await getVeloraAccessToken();

      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ CHAT MESSAGES
    --------------------------------------------------------- */
    socket.on("newMessage", (payload) => {
      console.log("[VELORA RAW CHAT]", payload);

      try {
        const msg = transformVeloraChatMessage(payload);
        if (msg) dedupeVeloraChat(msg, onMessage);
      } catch (err) {
        console.error("[VELORA] newMessage handler error:", err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ EVENTS (non-chat)
    --------------------------------------------------------- */
    socket.onAny((event, payload) => {
      if (event === "newMessage") return;

      console.log(`[VELORA RAW EVENT] ${event}`, payload);

      try {
        const evt = transformVeloraEvent(event, payload);
        if (evt) onMessage(evt);
      } catch (err) {
        console.error(`[VELORA] Event handler error (${event}):`, err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ ERROR HANDLER
    --------------------------------------------------------- */
    socket.on("error", (err) => {
      console.error("[VELORA] Chat socket error:", err);
    });

    /* ---------------------------------------------------------
       ⭐ DISCONNECT → RECONNECT
    --------------------------------------------------------- */
    socket.on("disconnect", async (reason) => {
      console.log("[VELORA] Chat socket disconnected:", reason);

      try {
        socket.close();
      } catch {}

      // Fetch a new token before reconnecting
      await getVeloraAccessToken();

      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ HEARTBEAT (Velora uses ping/pong)
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
