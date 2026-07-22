export async function loadCurrentDate() {
  console.log("DATE LOADER RAN");

  try {
    const res = await fetch("/overlay/chat/utils/date.html", {
      method: "GET",
      headers: { "Accept": "text/html" }
    });

    console.log("FETCH STATUS:", res.status);

    const html = await res.text();
    console.log("FETCHED HTML:", html);

    const el = document.getElementById("current-date");
    console.log("CURRENT-DATE ELEMENT:", el);

    if (el) {
      el.innerHTML = html;
      console.log("HTML INSERTED");
    } else {
      console.log("ELEMENT NOT FOUND");
    }

  } catch (err) {
    console.error("[Header] Failed to load date HTML:", err);

    const el = document.getElementById("current-date");
    if (el) el.textContent = "";
  }
}
