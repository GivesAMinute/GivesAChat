// utils/sanitizeHTML.js

export function sanitizeHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  const allowedTags = new Set([
    "B", "I", "EM", "STRONG", "SPAN", "DIV", "IMG", "VIDEO", "BR"
  ]);

  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );

  const toRemove = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (!allowedTags.has(node.tagName)) {
      toRemove.push(node);
      continue;
    }

    if (node.tagName === "IMG") {
      node.removeAttribute("onerror");
      node.removeAttribute("onclick");
      node.removeAttribute("onload");
    }

    if (node.tagName === "VIDEO") {
      node.removeAttribute("onerror");
      node.removeAttribute("onclick");
      node.removeAttribute("onload");
    }
  }

  toRemove.forEach(n => n.remove());

  return template.innerHTML;
}
