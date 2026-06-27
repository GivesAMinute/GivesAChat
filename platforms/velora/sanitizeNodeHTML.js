// platforms/velora/sanitizeNodeHTML.js
import sanitizeHtmlLib from "sanitize-html";

export function sanitizeHtml(html) {
  return sanitizeHtmlLib(html || "", {
    allowedTags: sanitizeHtmlLib.defaults.allowedTags.concat(["img", "video"]),
    allowedAttributes: {
      "*": ["style", "class"],
      img: ["src", "alt"],
      video: ["src", "autoplay", "loop", "muted", "playsinline"]
    }
  });
}
