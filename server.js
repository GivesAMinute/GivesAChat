console.log("ENV REFRESH TOKEN:", process.env.BLAZE_REFRESH_TOKEN);
console.log("ENV CLIENT SECRET:", process.env.BLAZE_CLIENT_SECRET);

import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

import { refreshBlazeToken } from "./blaze/blazeAuth.js";
import { startBlaze } from "./blaze/index.js";

// Resolve __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("DEBUG __dirname:", __dirname);

// Express setup
const app = express();

// Overlay path: /app/backend/dist/overlay
const overlayPath = path.join(__dirname, "backend", "dist", "overlay");
console.log("DEBUG overlayPath:", overlayPath);

// Serve overlay assets
app.use("/overlay/assets", express.static(path.join(overlayPath, "assets")));

// Serve overlay HTML
app.get("/overlay", (req, res) => {
  res.sendFile(path.join(overlayPath, "index.html"));
});

// Root route
app.get("/", (req, res) => {
  res.send("GivesAChat backend is running");
});

// Start HTTP server
const server = app.listen(8080, () => {
  console.log("[Backend] Running on port 8080");
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[Backend] WebSocket client connected");

  ws.on("close", () => {
    console.log("[Backend] Client disconnected");
  });
});

// Broadcast helper
function broadcast(msg) {
  const json = JSON.stringify(msg);

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(json);
    }
  });
}

// ⭐ Startup: init in-memory tokens, refresh once, start Blaze, schedule refresh
async function init() {
  try {
    // 1. Seed in-memory tokens from env on first boot
    globalThis.blazeAccessToken = process.env.BLAZE_ACCESS_TOKEN;
    globalThis.blazeRefreshToken = process.env.BLAZE_REFRESH_TOKEN;

    // 2. Do ONE refresh to get a guaranteed good access token
    await refreshBlazeToken();

    // 3. Start Blaze poller + EventSub with fresh token
    startBlaze(broadcast);

    // 4. Refresh every 12 hours
    setInterval(refreshBlazeToken, 12 * 60 * 60 * 1000);

  } catch (err) {
    console.error("❌ Fatal error during startup:", err);
  }
}

init();
