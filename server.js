import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

// PLATFORM MODULES
import { startBlaze } from "./platforms/blaze/index.js";
import { startYouTube } from "./platforms/youtube/index.js";
import { startVeloraPlatform } from "./platforms/velora/index.js";

// TTS + EVENTS (dummy for now)
import { refreshBlazeToken } from "./platforms/blaze/blazeAuth.js";
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
   ⭐ HEALTHCHECK (prevents Railway restart loops)
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
   HTTP + WEBSOCKET SERVER
--------------------------------------------------------- */
const server = app.listen(8080, () => {
  console.log("[Backend] Running on port 8080");

  // Local test message
  broadcast({
    type: "chat",
    platform: "local",
    username: "LocalTester",
    html: "Hello from local test"
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[WS] Overlay connected");
  ws.on("close", () => console.log("[WS] Overlay disconnected"));
});

/* ---------------------------------------------------------
   ⭐ BROADCAST (safe + crash-proof)
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
   ⭐ STARTUP (PLATFORMS + TOKENS)
--------------------------------------------------------- */
async function init() {
  try {
    globalThis.blazeAccessToken = process.env.BLAZE_ACCESS_TOKEN;
    globalThis.blazeRefreshToken = process.env.BLAZE_REFRESH_TOKEN;

    setInterval(refreshBlazeToken, 12 * 60 * 60 * 1000);

    // Start platforms
    startBlaze(broadcast);
    startYouTube(broadcast);

    // ⭐ Velora platform (chat + events)
    const veloraSockets = startVeloraPlatform({
      channelId: "GivesAMinute",
      broadcast
    });

    // Store sockets globally for graceful shutdown
    globalThis.veloraChatSocket = veloraSockets.chat;
    globalThis.veloraEventsSocket = veloraSockets.events;

    console.log("[Backend] All platforms initialized");
  } catch (err) {
    console.error("❌ Fatal startup error:", err);
  }
}

init();

/* ---------------------------------------------------------
   ⭐ GRACEFUL SHUTDOWN (fixes Railway SIGTERM kills)
--------------------------------------------------------- */
function gracefulShutdown() {
  console.log("[Backend] Received SIGTERM — shutting down gracefully…");

  try {
    if (globalThis.veloraChatSocket) {
      console.log("[Backend] Closing Velora chat socket…");
      globalThis.veloraChatSocket.close();
    }

    if (globalThis.veloraEventsSocket) {
      console.log("[Backend] Closing Velora events socket…");
      globalThis.veloraEventsSocket.close();
    }
  } catch (err) {
    console.error("[Backend] Error closing Velora sockets:", err);
  }

  // Allow final broadcasts to flush
  setTimeout(() => {
    console.log("[Backend] Shutdown complete");
    process.exit(0);
  }, 500);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
