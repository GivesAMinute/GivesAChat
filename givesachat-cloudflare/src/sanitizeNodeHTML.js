// givesachat-cloudflare/src/sanitizeNodeHTML.js

export function sanitizeHtml(html = "") {
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/ on\w+="[^"]*"/gi, "");

  const allowedTags = ["img", "video", "b", "i", "u", "span", "div", "p", "strong", "em", "br"];

  return html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, tag, attrs) => {
    tag = tag.toLowerCase();

    if (!allowedTags.includes(tag)) {
      return "";
    }

    const safeAttrs = [];

    attrs.replace(/([a-zA-Z-]+)="([^"]*)"/g, (m, name, value) => {
      name = name.toLowerCase();

      if (name === "src" || name === "alt" || name === "class" || name === "style") {
        safeAttrs.push(`${name}="${value}"`);
      }
    });

    return `<${tag}${safeAttrs.length ? " " + safeAttrs.join(" ") : ""}>`;
  });
}
