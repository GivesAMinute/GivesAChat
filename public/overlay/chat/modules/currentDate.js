/**
 * Loads the date HTML file and inserts it into #current-date.
 */
export async function loadCurrentDate() {
  try {
    const res = await fetch("/overlay/chat/utils/date.html", {
      method: "GET",
      headers: {
        "Accept": "text/html"
      }
    });

    const html = await res.text();

    const el = document.getElementById("current-date");
    if (el) el.innerHTML = html;

  } catch (err) {
    console.error("[Header] Failed to load date HTML:", err);

    // Fail-safe: do not break the header
    const el = document.getElementById("current-date");
    if (el) el.textContent = "";
  }
}
