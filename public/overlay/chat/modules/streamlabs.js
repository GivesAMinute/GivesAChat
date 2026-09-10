// public/overlay/chat/modules/streamlabs.js

/* ---------------------------------------------------------
   YouTube superchats, via Streamlabs.

   A superchat reaches neither of our existing pipelines. Beam
   does not relay them, and Velora has no view of what someone
   paid on another platform. Streamlabs does see them — the alert
   box has been showing them all along — and publishes them on
   its Socket API.

   So this opens that socket and turns a superchat into a normal
   chat bubble in the lane, which gets TTS for free.

   ⚠️ SOCKET.IO 2.x, NOT 4.x.

   Streamlabs' documentation pins the 2.0.3 client, and a v4
   client cannot handshake with a v2 server — it fails at the
   protocol level and looks like a dead connection rather than a
   version error. index.html loads that build as a global; this
   module deliberately does NOT import the 4.7.2 ESM build the
   Blaze module used, which is sitting in this same directory and
   is the obvious wrong thing to copy.

   The token comes from the worker at runtime rather than from
   the overlay URL — see /api/streamlabs/token. Overlay URLs get
   pasted into scene collections and screenshots.
--------------------------------------------------------- */

import { withKey } from "/overlay/shared/_shared.js";
import { handleChat } from "./chatRenderer.js";

const SOCKET_URL = "https://sockets.streamlabs.com";

let socket = null;

/* ---------------------------------------------------------
   Streamlabs replays recent events on connect, and a reconnect
   would therefore repeat whatever it just showed. Every event
   carries a stable `_id`, so this remembers the ones already
   rendered.

   Capped: this page stays open for a whole stream.
--------------------------------------------------------- */
const seen = new Set();

function alreadySeen(id) {
  if (!id) return false;
  if (seen.has(id)) return true;

  seen.add(id);
  if (seen.size > 400) {
    for (const old of seen) {
      seen.delete(old);
      if (seen.size <= 300) break;
    }
  }
  return false;
}

/* Escaped by hand because this text has NOT been through the
   worker's sanitiser — it arrives straight from Streamlabs into
   the browser, and it ends up in innerHTML downstream. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------------------------------------------------------
   One superchat -> one chat bubble.

   Rendered through handleChat rather than as a stream-alert
   card, because that is what a superchat IS on YouTube: a chat
   message with money attached, shown inline and highlighted.
   Going through handleChat also means it inherits the bubble,
   the platform icon, the exit timing, the scroll-back behaviour
   and the TTS queue without re-implementing any of it.

   `displayString` is the field to show — "$2.00". `amount` is
   "2000000", the value in micros, and rendering that would put
   two million dollars on the overlay.
--------------------------------------------------------- */
function renderSuperchat(item) {
  const container = document.getElementById("messages");
  if (!container) return;

  /* ---------------------------------------------------------
     ⭐ THE NAME NEEDS ESCAPING TOO, NOT JUST THE COMMENT.

     handleChat() writes the username into innerHTML:

       <span class="username">${payload.username}</span>

     which is safe for every other caller, because every other
     caller gets its payload from the worker and the worker
     sanitises. This one does not — it comes from Streamlabs
     straight into the browser — so a display name of
     `<img src=x onerror=…>` would execute on the live overlay.

     Escaped here rather than trusted upstream.
  --------------------------------------------------------- */
  const name = escapeHtml(item?.name || "Someone");
  const amount = String(item?.displayString || "").trim();
  const comment = String(item?.comment || "").trim();

  /* Reads as "Benny12C on youtube says: superchat $5.00 — thanks
     for the stream" once TTS gets hold of it. The word
     "superchat" is in the text on purpose: without it the amount
     is just a number in a sentence. */
  const parts = [];
  if (amount) {
    parts.push(
      `<span class="superchat-amount">superchat ${escapeHtml(amount)}</span>`
    );
  }
  if (comment) parts.push(escapeHtml(comment));

  handleChat(
    {
      type: "chat",
      platform: "youtube",
      username: name,
      avatar: null,
      badges: [],
      html: parts.join(" — ") || `<span class="superchat-amount">superchat</span>`,
      superchat: true
    },
    container
  );
}

async function fetchToken() {
  const res = await fetch(withKey("/api/streamlabs/token"), {
    headers: { Accept: "application/json" }
  });

  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);

  const body = await res.json();

  if (!body?.ok || !body.token) {
    /* The endpoint explains itself when the secret is unset —
       surface that rather than a generic failure, because "no
       superchats appeared" and "the secret was never set" look
       identical from the overlay. */
    throw new Error(body?.reason || "no token returned");
  }

  return body.token;
}

export async function setupStreamlabs() {
  if (typeof window.io !== "function") {
    console.warn(
      "[Streamlabs] socket.io client not loaded — superchats will not appear. " +
      "index.html must include the 2.x build."
    );
    return;
  }

  let token;
  try {
    token = await fetchToken();
  } catch (err) {
    console.warn(`[Streamlabs] not connecting: ${err.message}`);
    return;
  }

  socket = window.io(`${SOCKET_URL}?token=${encodeURIComponent(token)}`, {
    transports: ["websocket"]
  });

  socket.on("connect", () => console.log("[Streamlabs] connected"));

  /* Named explicitly because a version mismatch between the
     client and Streamlabs' server surfaces here and nowhere
     else — silence otherwise. */
  socket.on("connect_error", (err) =>
    console.warn("[Streamlabs] connect_error:", err?.message || err)
  );

  socket.on("disconnect", (reason) =>
    console.log("[Streamlabs] disconnected:", reason)
  );

  socket.on("event", (eventData) => {
    /* `message` is ALWAYS an array, even for a single event —
       stated plainly in Streamlabs' docs and easy to miss,
       because every example shows exactly one entry. */
    const items = Array.isArray(eventData?.message)
      ? eventData.message
      : [eventData?.message].filter(Boolean);

    if (eventData?.type !== "superchat") return;
    if (eventData?.for && eventData.for !== "youtube_account") return;

    for (const item of items) {
      if (alreadySeen(item?._id || item?.id)) {
        console.log("[Streamlabs] superchat already shown, skipping replay");
        continue;
      }

      console.log(
        `[Streamlabs] superchat from ${item?.name} — ${item?.displayString}`
      );
      renderSuperchat(item);
    }
  });
}

export function stopStreamlabs() {
  try { socket?.disconnect(); } catch {}
  socket = null;
}
