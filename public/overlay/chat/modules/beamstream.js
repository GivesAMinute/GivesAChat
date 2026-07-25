// public/overlay/chat/modules/beamstream.js

import { handleChat } from "./chatRenderer.js";
import { getMessagesContainer } from "./websocket.js";

/**
 * Beamstream Socket.IO / Engine.IO client
 * Connects to Beamstream chat WebSocket from the browser (cookies present),
 * parses incoming events, and forwards them into your existing chat renderer.
 */

const BEAM_WS_URL =
  "wss://beamstream.gg/api/chat/api/v1/socket/?EIO=4&transport=websocket";

let beamSocket = null;

function startBeamstreamChat() {
  if (beamSocket && beamSocket.readyState === WebSocket.OPEN) return;

  try {
    beamSocket = new WebSocket(BEAM_WS_URL);

    beamSocket.addEventListener("open", () => {
      console.log("[Beamstream] WebSocket connected");
    });

    beamSocket.addEventListener("close", () => {
      console.log("[Beamstream] WebSocket closed");
      // Optional: simple reconnect
      setTimeout(startBeamstreamChat, 3000);
    });

    beamSocket.addEventListener("error", (err) => {
      console.warn("[Beamstream] WebSocket error:", err);
    });

    beamSocket.addEventListener("message", (event) => {
      try {
        const data = event.data;

        // Engine.IO / Socket.IO framing:
        // "0"  = open
        // "40" = Socket.IO open
        // "42" = Socket.IO event: 42["eventName", payload]
        if (typeof data !== "string") return;

        // Only care about Socket.IO event packets
        if (!data.startsWith("42")) return;

        // Strip "42" and parse the JSON array
        const json = data.slice(2);
        const arr = JSON.parse(json);

        const eventName = arr[0];
        const payload = arr[1];

        // You may need to adjust this once you inspect Beamstream payloads.
        // Common patterns are "chat_message", "message", "chat".
        if (!payload) return;

        // Map Beamstream payload into your existing chat format.
        // This is a generic mapper; tweak fields once you see real payloads.
        const mapped = mapBeamstreamToOverlay(payload);
        if (!mapped) return;

        const container = getMessagesContainer();
        if (!container) return;

        // IMPORTANT: avoid Velora duplicates.
        // If Beamstream also sends Velora messages, ensure we only
        // forward non-Velora platforms here.
        if (mapped.platform === "velora") {
          return;
        }

        handleChat(mapped, container);

      } catch (err) {
        console.warn("[Beamstream] Failed to parse message:", err);
      }
    });
  } catch (err) {
    console.warn("[Beamstream] Failed to open WebSocket:", err);
  }
}

/**
 * Map Beamstream chat payload into your existing overlay chat shape.
 * Adjust this once you inspect the actual Beamstream payload structure.
 */
function mapBeamstreamToOverlay(payload) {
  // Example guess — you will need to align these with real Beamstream fields.
  const username =
    payload.username ||
    payload.user?.name ||
    payload.author?.displayName;

  const message =
    payload.message ||
    payload.text ||
    payload.content;

  if (!username || !message) return null;

  return {
    type: "chat",
    platform: payload.platform || "beamstream",
    data: {
      username,
      message,
      // Optional fields — adjust as needed
      userId: payload.userId || payload.user?.id,
      badges: payload.badges || [],
      emotes: payload.emotes || [],
      // You can add more fields here once you see the payload.
    }
  };
}

export {
  startBeamstreamChat
};
