// ---------------------------------------------------------
// ⭐ SHARED CONFIG FOR ALL OVERLAYS
// ---------------------------------------------------------

/* ---------------------------------------------------------
   ⭐ Brave/iOS Stability Fix
   Delay URL construction by ~50ms to avoid early JS stalls
   when multiple modules import this file simultaneously.
--------------------------------------------------------- */
let wsURL = null;

setTimeout(() => {
  wsURL =
    (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host +
    "/ws";
}, 50);

/* ---------------------------------------------------------
   ⭐ Exported Shared Object
--------------------------------------------------------- */
const _shared = {
  get wsURL() {
    return wsURL;
  }
};

export default _shared;
