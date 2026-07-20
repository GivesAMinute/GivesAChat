// ---------------------------------------------------------
// ⭐ SHARED CONFIG FOR ALL OVERLAYS
// ---------------------------------------------------------

const _shared = {
  wsURL:
    (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host +
    "/ws"
};

export default _shared;
