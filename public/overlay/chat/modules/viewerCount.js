// public/overlay/chat/modules/viewerCount.js

const VIEWER_API = "/api/viewers";

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
      json?.viewers !== undefined ? json.viewers : "0";

    const el = document.getElementById("viewer-count");
    if (el) el.textContent = count;

  } catch (err) {
    console.warn("[Header] Viewer API error:", err);

    const el = document.getElementById("viewer-count");
    if (el) el.textContent = "0";
  }
}
