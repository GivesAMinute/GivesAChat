// public/overlay/chat/modules/beamstream.js

import { socket } from "./websocket.js";

/*
  ⭐ Invisible iframe Beamstream scraper
  Scrapes Beamstream chat inside the overlay (no server needed)
*/

export function startBeamstreamScraper() {
  console.log("[Beamstream] Initializing iframe scraper…");

  const iframe = document.createElement("iframe");
  iframe.src = "https://beamstream.gg/givesaminute/chat";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.style.position = "absolute";
  iframe.style.left = "-9999px";
  iframe.style.top = "-9999px";

  document.body.appendChild(iframe);

  iframe.onload = () => {
    console.log("[Beamstream] Iframe loaded, attaching observer…");

    const doc = iframe.contentDocument || iframe.contentWindow.document;

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
      const nodes = [...doc.querySelectorAll('[typeof="ChatMessage"]')];
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

      // ⭐ Send to Worker via existing WebSocket
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "chat",
          platform: "beamstream",
          data: {
            username,
            message: html + stickerHTML,
            avatar,
            badges
          }
        }));
      }
    });

    observer.observe(doc.body, { childList: true, subtree: true });

    console.log("[Beamstream] DOM observer active.");
  };
}
