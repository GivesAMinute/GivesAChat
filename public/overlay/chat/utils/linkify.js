// public/overlay/chat/utils/linkify.js

/* ---------------------------------------------------------
   Turn URLs in chat into clickable links.

   Runs on TEXT NODES ONLY, after the message HTML is already
   in the DOM. That matters: message HTML has been through the
   worker's sanitiser, and walking text nodes means we can't
   accidentally rewrite an emote's src or nest a link inside
   markup that already exists.

   The href is built here rather than taken from the message,
   and only http/https survive — so a "javascript:" or "data:"
   URL typed into chat can never become a live link.
--------------------------------------------------------- */

// Deliberately conservative: bare www. and scheme-less domains
// are left alone to avoid mangling ordinary sentences.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

// Trailing punctuation is almost always sentence punctuation
// rather than part of the URL: "see https://x.com/foo."
const TRAILING = /[.,;:!?)\]}'"]+$/;

function isSafeHref(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Shorten for display without changing where the link points. */
function displayText(url, max = 45) {
  const stripped = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return stripped.length > max ? stripped.slice(0, max - 1) + "…" : stripped;
}

function linkifyTextNode(node) {
  const text = node.nodeValue;
  if (!text || !URL_RE.test(text)) return;

  URL_RE.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = URL_RE.exec(text)) !== null) {
    let url = match[0];
    let trailing = "";

    const trailMatch = url.match(TRAILING);
    if (trailMatch) {
      trailing = trailMatch[0];
      url = url.slice(0, -trailing.length);
    }

    if (match.index > lastIndex) {
      frag.appendChild(
        document.createTextNode(text.slice(lastIndex, match.index))
      );
    }

    if (isSafeHref(url)) {
      const a = document.createElement("a");
      a.className = "chat-link";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.textContent = displayText(url);
      frag.appendChild(a);
    } else {
      frag.appendChild(document.createTextNode(url));
    }

    if (trailing) frag.appendChild(document.createTextNode(trailing));

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  node.parentNode.replaceChild(frag, node);
}

/**
 * Linkify every text node beneath `root`.
 * @param {HTMLElement} root
 */
export function linkify(root) {
  if (!root) return;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Never touch text already inside a link.
        if (node.parentElement?.closest("a")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  // Collect first — replacing nodes while walking invalidates the walker.
  const nodes = [];
  let current;
  while ((current = walker.nextNode())) nodes.push(current);

  for (const node of nodes) linkifyTextNode(node);
}
