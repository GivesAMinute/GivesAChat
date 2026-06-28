// platforms/velora/veloraDedupe.js

// Simple dedupe memory
const seen = new Set();

// Unified handler for all Velora chat messages
export function dedupeVeloraChat(msg, broadcast) {
  if (!msg || !msg.messageId) return;

  if (seen.has(msg.messageId)) return;
  seen.add(msg.messageId);

  broadcast({
    platform: "velora",
    ...msg
  });
}

// Clear memory every minute to avoid growth
setInterval(() => {
  seen.clear();
}, 60 * 1000);
