// Node-safe HTML sanitizer for backend → YouTube
// Escapes HTML so the browser overlay can safely re-sanitize it.

export function sanitizeNodeHTML(str) {
  if (!str || typeof str !== "string") return "";

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
