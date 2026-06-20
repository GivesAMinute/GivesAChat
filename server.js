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

const app = express();

// Correct overlay path: /app/backend/dist/overlay
const overlayPath = path.join(__dirname, "dist", "overlay");
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

// Start Blaze chat ingestion
startBlaze(broadcast);

// Refresh Blaze token on startup + every 12 hours
async function init() {
  await refreshBlazeToken();
  console.log("🔥 Blaze token refreshed");

  setInterval(refreshBlazeToken, 12 * 60 * 60 * 1000);
}

init();
