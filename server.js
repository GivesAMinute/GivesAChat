/* ---------------------------------------------------------
   ⭐ GLOBAL CRASH LOGGING
--------------------------------------------------------- */
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Promise Rejection:", err);
});

import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

// PLATFORM MODULES
import { startBlaze } from "./platforms/blaze/index.js";
import { startYouTube } from "./platforms/youtube/index.js";
import { startVeloraPlatform } from "./platforms/velora/index.js";

// TTS (dummy)
import "./tts/engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ---------------------------------------------------------
   ⭐ STATIC ASSETS
--------------------------------------------------------- */
app.use(express.static(path.join(__dirname, "public")));
app.use("/overlay", express.static(path.join(__dirname, "public/overlay")));

/* ---------------------------------------------------------
   ⭐ HEALTHCHECK
--------------------------------------------------------- */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ---------------------------------------------------------
   ROOT ROUTE
--------------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("GivesAChat backend is running");
});

/* ---------------------------------------------------------
   ⭐ HTTP SERVER
--------------------------------------------------------- */
const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`[Backend] Running on port ${PORT}`);
});

/* ---------------------------------------------------------
   ⭐ WEBSOCKET SERVER (REQUIRED FOR RAILPACK v0.30.0)
--------------------------------------------------------- */
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  console.log("[WS] Overlay connected");

  // Send a guaranteed test message to this client
  try {
    ws.send(
      JSON.stringify({
        type: "chat",
        platform: "local",
        username: "WSTester",
        html: "WebSocket is connected and sending data"
      })
    );
  } catch (err) {
    console.error("[WS] Error sending test message:", err);
  }

  ws.on("close", () => {
    console.log("[WS] Overlay disconnected");
  });
});

/* ---------------------------------------------------------
   ⭐ BROADCAST
--------------------------------------------------------- */
export function broadcast(payload) {
  try {
    const safe = JSON.parse(JSON.stringify(payload));
    const json = JSON.stringify(safe);

    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(json);
    });
  } catch (err) {
    console.error("[Broadcast] Error serializing payload:", err);
  }
}

/* ---------------------------------------------------------
   ⭐ STARTUP
--------------------------------------------------------- */
async function init() {
  console.log("[Backend] init() starting…");

  try {
    globalThis.blazeAccessToken = process.env.BLAZE_ACCESS_TOKEN;
    globalThis.blazeRefreshToken = process.env.BLAZE_REFRESH_TOKEN;

    setInterval(refreshBlazeToken, 12 * 60 * 60 * 1000);

    startBlaze(broadcast);
    startYouTube(broadcast);

    const veloraSockets = startVeloraPlatform({
      channelId: "GivesAMinute",
      broadcast
    });

    globalThis.veloraChatSocket = veloraSockets.chat;
    globalThis.veloraEventsSocket = veloraSockets.events;

    console.log("[Backend] All platforms initialized");
  } catch (err) {
    console.error("❌ Fatal startup error:", err);
  }

  console.log("[Backend] init() completed");
}

init();

/* ---------------------------------------------------------
   ⭐ GRACEFUL SHUTDOWN
--------------------------------------------------------- */
function gracefulShutdown() {
  console.log("[Backend] Received SIGTERM — shutting down gracefully…");

  try {
    if (globalThis.veloraChatSocket) {
      globalThis.veloraChatSocket.close();
    }

    if (globalThis.veloraEventsSocket) {
      globalThis.veloraEventsSocket.close();
    }
  } catch (err) {
    console.error("[Backend] Error closing Velora sockets:", err);
  }

  setTimeout(() => {
    console.log("[Backend] Shutdown complete");
    process.exit(0);
  }, 500);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
