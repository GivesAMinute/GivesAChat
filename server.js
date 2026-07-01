/* ---------------------------------------------------------
   ⭐ GLOBAL CRASH LOGGING
--------------------------------------------------------- */
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Promise Rejection:", err);
});

/* ---------------------------------------------------------
   ⭐ TOP‑LEVEL IMPORT CRASH DETECTOR
--------------------------------------------------------- */
console.log("[Backend] server.js starting…");

let express, WebSocketServer, path, fileURLToPath;
let startBlaze, startYouTube, startVeloraPlatform;

try {
  console.log("[Backend] Importing core modules…");
  express = (await import("express")).default;
  ({ WebSocketServer } = await import("ws"));
  path = (await import("path")).default;
  ({ fileURLToPath } = await import("url"));
  console.log("[Backend] Core modules imported.");
} catch (err) {
  console.error("❌ Fatal import error (core modules):", err);
  process.exit(1);
}

try {
  console.log("[Backend] Importing platform modules…");
  ({ startBlaze } = await import("./platforms/blaze/index.js"));
  ({ startYouTube } = await import("./platforms/youtube/index.js"));
  ({ startVeloraPlatform } = await import("./platforms/velora/index.js"));
  console.log("[Backend] Platform modules imported.");
} catch (err) {
  console.error("❌ Fatal import error (platform modules):", err);
  process.exit(1);
}

try {
  console.log("[Backend] Importing TTS engine…");
  await import("./tts/engine.js");
  console.log("[Backend] TTS engine imported.");
} catch (err) {
  console.error("❌ Fatal import error (TTS engine):", err);
  process.exit(1);
}

/* ---------------------------------------------------------
   ⭐ EXPRESS + STATIC FILES
--------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

console.log("[Backend] Setting up static assets…");
app.use(express.static(path.join(__dirname, "public")));
app.use("/overlay", express.static(path.join(__dirname, "public/overlay")));
console.log("[Backend] Static assets ready.");

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

console.log("[Backend] Starting HTTP server…");
const server = app.listen(PORT, () => {
  console.log(`[Backend] Running on port ${PORT}`);
});

/* ---------------------------------------------------------
   ⭐ WEBSOCKET SERVER (Railpack v0.30.0)
--------------------------------------------------------- */
console.log("[Backend] Setting up WebSocket server…");
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
   ⭐ STARTUP (init)
--------------------------------------------------------- */
async function init() {
  console.log("[Backend] init() starting…");

  try {
    console.log("[Backend] Loading Blaze tokens…");
    globalThis.blazeAccessToken = process.env.BLAZE_ACCESS_TOKEN;
    globalThis.blazeRefreshToken = process.env.BLAZE_REFRESH_TOKEN;

    console.log("[Backend] Starting Blaze…");
    startBlaze(broadcast);

    console.log("[Backend] Starting YouTube…");
    startYouTube(broadcast);

    console.log("[Backend] Starting Velora…");
    const veloraSockets = await startVeloraPlatform({
      channelId: "GivesAMinute",
      broadcast
    });

    globalThis.veloraChatSocket = veloraSockets.chat;
    globalThis.veloraEventsSocket = veloraSockets.events;

    console.log("[Backend] All platforms initialized.");
  } catch (err) {
    console.error("❌ Fatal startup error inside init():", err);
  }

  console.log("[Backend] init() completed.");
}

try {
  console.log("[Backend] Calling init()…");
  init();
} catch (err) {
  console.error("❌ Fatal error calling init():", err);
}

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
