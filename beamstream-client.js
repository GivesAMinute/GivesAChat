import WebSocket from "ws";

const WORKER_URL = "wss://givesachat-cloudflare.benonkoebsch.workers.dev/ws/chat";

let ws = null;
let heartbeatInterval = null;

function connect() {
  console.log("[Beamstream] Connecting to Cloudflare Worker…");

  ws = new WebSocket(WORKER_URL);

  ws.on("open", () => {
    console.log("[Beamstream] Connected.");
    startHeartbeat();
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      console.log("[Beamstream] Event:", data);
    } catch (err) {
      console.log("[Beamstream] Raw:", msg.toString());
    }
  });

  ws.on("close", () => {
    console.log("[Beamstream] Connection closed. Reconnecting in 3s…");
    stopHeartbeat();
    setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    console.log("[Beamstream] Error:", err.message);
  });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
    }
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

connect();


