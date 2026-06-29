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
   ⭐ STATIC ASSETS (icons, audio, tts output)
--------------------------------------------------------- */
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------------------------------------------
   ⭐ OVERLAY ROUTES (MATCHES YOUR REAL FOLDERS)
--------------------------------------------------------- */
// Serve overlay directly from public/overlay
app.use("/overlay", express.static(path.join(__dirname, "public/overlay")));

/* ---------------------------------------------------------
   ⭐ HEALTHCHECK (Railway needs this to stop SIGTERM restarts)
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

  // ⭐ LOCAL TEST MESSAGE — lets you verify double-up instantly
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
   ⭐ BROADCAST HELPER
--------------------------------------------------------- */
export function broadcast(payload) {
  const json = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(json);
  });
}

/* ---------------------------------------------------------
   ⭐ STARTUP (PLATFORMS + TOKENS)
--------------------------------------------------------- */
async function init() {
  try {
    // Blaze OAuth tokens (production only)
    globalThis.blazeAccessToken = process.env.BLAZE_ACCESS_TOKEN;
    globalThis.blazeRefreshToken = process.env.BLAZE_REFRESH_TOKEN;

    // Blaze token refresh every 12 hours
    setInterval(refreshBlazeToken, 12 * 60 * 60 * 1000);

    // Start platforms
    startBlaze(broadcast);
    startYouTube(broadcast);

    // ⭐ NEW: Start Velora
    startVeloraPlatform({
      channelId: "GivesAMinute",
      broadcast
    });

    console.log("[Backend] All platforms initialized");
  } catch (err) {
    console.error("❌ Fatal startup error:", err);
  }
}

init();
