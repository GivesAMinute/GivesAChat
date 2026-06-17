// backend/server.js
import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

import { refreshBlazeToken } from "./blaze/blazeAuth.js";
import { startBlaze } from "./blaze/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("DEBUG __dirname:", __dirname);

const app = express();
const distPath = path.join(__dirname, "dist");
console.log("DEBUG distPath:", distPath);

app.use(express.static(distPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

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
