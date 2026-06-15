import express from "express";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve overlay from dist/
const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`[Backend] Running on port ${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[Backend] WebSocket client connected");

  ws.on("message", (data) => {
    console.log("[Backend] Incoming:", data.toString());

    // Broadcast to all connected clients
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data.toString());
      }
    }
  });

  ws.on("close", () => console.log("[Backend] Client disconnected"));
  ws.on("error", (err) => console.error("[Backend] WS error:", err));
});
