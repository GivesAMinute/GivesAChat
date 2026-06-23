// ---------------------------------------------------------
// ⭐ SHARED CONFIG FOR ALL OVERLAYS
// ---------------------------------------------------------

// Automatically chooses ws:// for local and wss:// for Railway
const _shared = {
  wsURL:
    (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host
};

export default _shared;
