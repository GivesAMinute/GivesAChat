// platforms/blaze/sanitizeNodeHTML.js
export function sanitizeNodeHTML(input = "") {
  if (!input || typeof input !== "string") return "";

  // Basic escape first
  let html = input.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Allowlist of safe tags
  const allowedTags = [
    "b", "i", "em", "strong", "span", "a", "img", "br"
  ];

  // Convert allowed tags back from escaped form
  allowedTags.forEach(tag => {
    const open = new RegExp(`&lt;${tag}(\\s[^&]*?)?&gt;`, "gi");
    const close = new RegExp(`&lt;\\/${tag}&gt;`, "gi");

    html = html
      .replace(open, `<${tag}$1>`)
      .replace(close, `</${tag}>`);
  });

  // Remove dangerous attributes
  html = html.replace(/\son\w+="[^"]*"/gi, "");
  html = html.replace(/\son\w+='[^']*'/gi, "");

  // Remove script/style/iframe entirely
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");

  return html;
}
