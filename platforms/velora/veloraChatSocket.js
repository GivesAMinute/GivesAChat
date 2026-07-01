// platforms/velora/veloraChatSocket.js
import { io } from "socket.io-client";
import { getVeloraAccessToken } from "./veloraAuth.js";
import {
  transformVeloraChatMessage,
  transformVeloraEvent
} from "./veloraTransform.js";
import { dedupeVeloraChat } from "./veloraDedupe.js";

/**
 * Velora Chat WebSocket
 * Namespace: wss://api.velora.tv/chat
 */

export function startVeloraChatSocket({ channelId, onMessage }) {
  const connectSocket = async () => {
    let socket;

    const accessToken = await getVeloraAccessToken();
    if (!accessToken) {
      console.error("[VELORA] Cannot connect chat — no access token");
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

      await getVeloraAccessToken();
      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ NEW CHAT MESSAGE (async for emotes)
    --------------------------------------------------------- */
    socket.on("newMessage", async (payload) => {
      console.log("[VELORA RAW CHAT]", payload);

      try {
        const msg = await transformVeloraChatMessage(payload);
        if (msg) dedupeVeloraChat(msg, onMessage);
      } catch (err) {
        console.error("[VELORA] newMessage handler error:", err);
      }
    });

    /* ---------------------------------------------------------
       ⭐ ALL OTHER EVENTS (async for emotes)
    --------------------------------------------------------- */
    socket.onAny(async (event, payload) => {
      if (event === "newMessage") return;

      console.log(`[VELORA RAW EVENT] ${event}`, payload);

      try {
        const evt = await transformVeloraEvent(event, payload);
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

      await getVeloraAccessToken();
      setTimeout(connectSocket, 3000);
    });

    /* ---------------------------------------------------------
       ⭐ PING/PONG HEARTBEAT
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
