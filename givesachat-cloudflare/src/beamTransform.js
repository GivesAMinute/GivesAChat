import { sanitizeHtml } from "./sanitizeNodeHTML.js";

// Convert Quill Delta ops → plain text
function quillToText(ops) {
  return ops
    .map(op => {
      if (typeof op.insert === "string") return op.insert;

      if (typeof op.insert === "object" && op.insert.type === "emote") {
        return `[${op.insert.name}]`;
      }

      return "";
    })
    .join("");
}

// Convert Quill Delta ops → HTML
function quillToHTML(ops) {
  return ops
    .map(op => {
      if (typeof op.insert === "string") {
        return sanitizeHtml(op.insert);
      }

      if (typeof op.insert === "object" && op.insert.type === "emote") {
        return `<img class="chat-emote" src="${op.insert.url}" alt="${op.insert.name}" />`;
      }

      return "";
    })
    .join("");
}

export function transformBeamMessage(raw) {
  // Exclude Velora + Blaze (your requirement)
  if (raw.senderType === "velora") return null;
  if (raw.senderType === "blaze") return null;

  const text = quillToText(raw.content?.ops || []);
  const html = quillToHTML(raw.content?.ops || []);

  return {
    platform: raw.senderType || "beam",
    username: raw.senderMeta?.displayName || "",
    html,
    avatar: raw.senderMeta?.avatarUrl || null,
    badges: raw.senderMeta?.badges || [],
    sticker: null,
    timestamp: raw.createdAtMs || Date.now()
  };
}
