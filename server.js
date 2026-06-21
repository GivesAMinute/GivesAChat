import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

import { refreshBlazeToken } from "./blaze/blazeAuth.js";
import { startBlaze } from "./blaze/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ---------------------------------------------------------
   ⭐ Serve /public at root (FIXES /icons/*.png)
--------------------------------------------------------- */
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------------------------------------------
   ⭐ Overlay build output
--------------------------------------------------------- */
const overlayPath = path.join(__dirname, "backend", "dist", "overlay");

app.use("/overlay/assets", express.static(path.join(overlayPath, "assets")));

app.get("/overlay", (req, res) => {
  res.sendFile(path.join(overlayPath, "index.html"));
});

/* ---------------------------------------------------------
   Root route
--------------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("GivesAChat backend is running");
});

/* ---------------------------------------------------------
   HTTP + WebSocket server
--------------------------------------------------------- */
const server = app.listen(8080, () => {
  console.log("[Backend] Running on port 8080");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[Backend] WebSocket client connected");
  ws.on("close", () => console.log("[Backend] Client disconnected"));
});

/* ---------------------------------------------------------
   Broadcast helper
--------------------------------------------------------- */
function broadcast(msg) {
  const json = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(json);
  });
}

/* ---------------------------------------------------------
   Startup
--------------------------------------------------------- */
async function init() {
  try {
    globalThis.blazeAccessToken = process.env.BLAZE_ACCESS_TOKEN;
    globalThis.blazeRefreshToken = process.env.BLAZE_REFRESH_TOKEN;

    startBlaze(broadcast);

    setInterval(refreshBlazeToken, 12 * 60 * 60 * 1000);
  } catch (err) {
    console.error("❌ Fatal error during startup:", err);
  }
}

init();
