// public/overlay/chat/modules/viewerCount.js

const VIEWER_API = "/api/viewers";
let lastViewerCount = 0;

/**
 * Fetches viewer count from Worker proxy
 * and updates #viewer-count in the header.
 */
export async function fetchViewerCount() {
  try {
    const res = await fetch(VIEWER_API, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    const json = await res.json();

    const count =
      json?.viewers !== undefined ? json.viewers : 0;

    const el = document.getElementById("viewer-count");
    if (!el) return;

    // ⭐ Trigger animation only when viewer count increases
    if (count > lastViewerCount) {
      el.classList.remove("viewer-pop"); // reset
      void el.offsetWidth;              // ⭐ force reflow
      el.classList.add("viewer-pop");   // retrigger animation
    }

    el.textContent = count;
    lastViewerCount = count;

  } catch (err) {
    console.warn("[Header] Viewer API error:", err);

    const el = document.getElementById("viewer-count");
    if (el) el.textContent = "0";
  }
}
