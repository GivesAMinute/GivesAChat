import puppeteer from "puppeteer";
import fetch from "node-fetch";

const BEAM_URL = "https://beamstream.gg/givesaminute/chat";
const WORKER_BROADCAST_URL = "https://givesaminute.tv/api/broadcast"; // adjust if needed

async function startBeamstreamScraper() {
  console.log("[Beamstream] Launching browser…");

  const browser = await puppeteer.launch({
    headless: true,        // set to false if you want to see the browser
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,800"
    ]
  });

  const page = await browser.newPage();

  console.log("[Beamstream] Navigating to chat page…");
  await page.goto(BEAM_URL, { waitUntil: "networkidle2" });

  console.log("[Beamstream] Injecting relay function…");

  await page.exposeFunction("relayBeam", async (msg) => {
    try {
      // ⭐ HARD FILTER — DO NOT ALLOW VELORA FROM BEAMSTREAM
      const p = msg.platform?.toLowerCase();
      if (p === "velora" || p?.includes("velora")) return;

      await fetch(WORKER_BROADCAST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "chat",
          platform: msg.platform || "beamstream",
          data: {
            username: msg.username,
            message: msg.html,
            avatar: msg.avatar,
            badges: msg.badges || []
          }
        })
      });
    } catch (err) {
      console.error("[Beamstream] Broadcast failed:", err);
    }
  });

  console.log("[Beamstream] Installing DOM observer…");

  await page.evaluate(() => {
    const safe = (el, selector) => {
      try { return el.querySelector(selector) || null; }
      catch { return null; }
    };

    const safeText = (el, selector, fallback = "") => {
      const node = safe(el, selector);
      return node?.innerText?.trim() || fallback;
    };

    const safeSrc = (el, selector) => {
      const node = safe(el, selector);
      const src = node?.src || null;
      return (typeof src === "string" && src.startsWith("http")) ? src : null;
    };

    const observer = new MutationObserver(() => {
      const nodes = [...document.querySelectorAll('[typeof="ChatMessage"]')];
      const last = nodes[nodes.length - 1];
      if (!last) return;

      const username =
        safeText(last, '[property="sender.name"]') ||
        safeText(last, ".username") ||
        "Unknown";

      let avatar =
        safeSrc(last, 'img[property="avatar"]') ||
        safeSrc(last, ".avatar img") ||
        safeSrc(last, "img.avatar") ||
        safeSrc(last, "img.user-avatar") ||
        safeSrc(last, "img[src*='avatar']") ||
        safeSrc(last, "img[src*='profile']") ||
        null;

      const badges = [...last.querySelectorAll(".badge img")]
        .map(img => img.src)
        .filter(src => typeof src === "string");

      const container =
        safe(last, '[property="body"]') ||
        safe(last, ".message") ||
        safe(last, ".msg-body") ||
        last;

      let html = "";
      try {
        const parts = [
          ...container.querySelectorAll(".text-fragment, .chat-image, img, video")
        ];

        html = parts
          .map(el => {
            if (el.tagName === "IMG") {
              const alt = (el.getAttribute("alt") || "").trim();
              if (!alt) return "";
              return el.outerHTML;
            }
            if (el.tagName === "VIDEO") return el.outerHTML;
            return el.outerHTML || el.textContent || "";
          })
          .join("");
      } catch {
        html = container?.innerText || "";
      }

      const sticker = safe(last, "img.sticker, video.sticker");
      const stickerHTML = sticker ? sticker.outerHTML : "";

      window.relayBeam({
        platform: "beam",
        username,
        html: html + stickerHTML,
        avatar,
        badges
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });

  console.log("[Beamstream] Chat observer active.");
}

startBeamstreamScraper().catch(err => {
  console.error("[Beamstream] Fatal error:", err);
});
