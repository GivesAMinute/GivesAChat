// platforms/velora/veloraDedupe.js

// Simple dedupe memory
const seen = new Set();

// Unified handler for all Velora chat messages
export function dedupeVeloraChat(msg, broadcast) {
  try {
    // Ignore null or malformed messages
    if (!msg || typeof msg !== "object") return;

    // Ignore messages without a dedupe key
    if (!msg.messageId) return;

    // Skip duplicates
    if (seen.has(msg.messageId)) return;
    seen.add(msg.messageId);

    // Safe broadcast
    broadcast({
      platform: "velora",
      ...msg
    });
  } catch (err) {
    console.error("[VELORA] dedupeVeloraChat error:", err);
  }
}

// Clear memory every minute to avoid growth
setInterval(() => {
  seen.clear();
}, 60 * 1000);
