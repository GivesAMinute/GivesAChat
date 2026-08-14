// ---------------------------------------------------------
// ⭐ SHARED CONFIG FOR ALL OVERLAYS
// ---------------------------------------------------------

/* ---------------------------------------------------------
   ⭐ Overlay key

   Read from this page's own query string and forwarded to the
   WebSocket URLs, so the key lives in your OBS browser-source
   URL rather than in this file (which anyone can read).

     /overlay/chat/?key=YOUR_OVERLAY_KEY

   With no key present the URLs are unchanged, so nothing
   breaks until OVERLAY_KEY is actually set on the worker.
--------------------------------------------------------- */
export function overlayKey() {
  try {
    return new URLSearchParams(location.search).get("key") || "";
  } catch {
    return "";
  }
}

export function withKey(url) {
  const key = overlayKey();
  if (!key) return url;
  return url + (url.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
}

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
