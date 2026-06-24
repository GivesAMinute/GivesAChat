import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

// PLATFORM MODULES
import { startBlaze } from "./platforms/blaze/index.js";
import { startYouTube } from "./platforms/youtube/index.js";

// TTS + EVENTS (dummy for now)
import { refreshBlazeToken } from "./platforms/blaze/blazeAuth.js";
import "./tts/engine.js";
import "./events/velora.js";

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
const overlayRoot = path.join(__dirname, "overlay");

// /overlay → redirect to /overlay/chat
app.get("/overlay", (req, res) => {
  res.redirect("/overlay/chat");
});

// Serve each overlay subfolder
app.use("/overlay/chat", express.static(path.join(overlayRoot, "chat")));
app.use("/overlay/tts", express.static(path.join(overlayRoot, "tts")));
app.use("/overlay/events", express.static(path.join(overlayRoot, "events")));
app.use("/overlay/shared", express.static(path.join(overlayRoot, "shared")));

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
   ⭐ LOCAL TEST MESSAGE (no Blaze auth needed)
--------------------------------------------------------- */
setTimeout(() => {
  broadcast({
    type: "chat",
    platform: "blaze",
    username: "LocalTester",
    message: "This is a local test message",
    avatar: null,
    badges: []
  });
  console.log("[LocalTest] Sent test chat message");
}, 2000);

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

    console.log("[Backend] All platforms initialized");
  } catch (err) {
    console.error("❌ Fatal startup error:", err);
  }
}

init();
