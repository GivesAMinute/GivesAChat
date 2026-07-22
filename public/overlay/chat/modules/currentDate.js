/**
 * Loads the date HTML file and inserts it into #current-date,
 * then updates the date text every minute.
 */
export async function loadCurrentDate() {
  try {
    const res = await fetch("/overlay/chat/utils/date.html", {
      method: "GET",
      headers: { "Accept": "text/html" }
    });

    const html = await res.text();

    const container = document.getElementById("current-date");
    if (!container) return;

    container.innerHTML = html;

    const output = document.getElementById("date-output");
    if (!output) return;

    function getOrdinalSuffix(day) {
      if (day > 3 && day < 21) return "th";
      switch (day % 10) {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
      }
    }

    function updateDate() {
      const now = new Date();

      const dayName = now.toLocaleDateString("en-AU", { weekday: "short" });
      const dayNum = now.getDate();
      const suffix = getOrdinalSuffix(dayNum);

      const fullMonthName = now.toLocaleDateString("en-AU", { month: "long" });
      const monthName = fullMonthName.substring(0, 3);

      const year = "'" + String(now.getFullYear()).slice(-2);

      const dateString = `${dayName} ${dayNum}${suffix} ${monthName} ${year}`;

      output.textContent = dateString;
    }

    updateDate();
    setInterval(updateDate, 60000);

  } catch (err) {
    console.error("[Header] Failed to load date HTML:", err);
  }
}
