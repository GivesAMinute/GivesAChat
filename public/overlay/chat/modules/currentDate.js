export async function loadCurrentDate() {
  console.log("DATE LOADER RAN"); // ⭐ TEMP DEBUG

  try {
    const res = await fetch("/overlay/chat/utils/date.html", {
      method: "GET",
      headers: { "Accept": "text/html" }
    });

    const html = await res.text();

    const el = document.getElementById("current-date");
    if (el) el.innerHTML = html;

  } catch (err) {
    console.error("[Header] Failed to load date HTML:", err);

    const el = document.getElementById("current-date");
    if (el) el.textContent = "";
  }
}
