// public/overlay/chat/modules/chatMode.js

/* ---------------------------------------------------------
   Chat display mode

   Two behaviours, chosen per browser source by URL:

     normal      messages slide off to the left after 45s
     persistent  messages stay put; new ones push older ones
                 up and out of view

   Add ?mode=persistent to the overlay URL:

     /overlay/chat/?key=YOUR_KEY&mode=persistent

   Both can run at once — each OBS browser source is its own
   page, so one source with the parameter and one without gives
   you both looks simultaneously.
--------------------------------------------------------- */

import { isScrolledBack } from "./chatScroll.js";

const DEFAULT_EXIT_DELAY_MS = 45000;
const EXIT_ANIMATION_MS = 800;

/* Persistent mode never removes anything, so the DOM would grow
   for the length of the stream. Messages above the top of the
   lane are clipped and invisible, so trimming the oldest is
   unnoticeable — it just stops thousands of nodes accumulating
   over a long broadcast. */
const MAX_PERSISTENT_MESSAGES = 150;

let cachedMode = null;

export function chatMode() {
  if (cachedMode) return cachedMode;

  let mode = "normal";

  try {
    const params = new URLSearchParams(location.search);
    const raw = (params.get("mode") || params.get("chat") || "").toLowerCase();

    const persistentFlag = params.has("persistent")
      ? (params.get("persistent") || "1").toLowerCase()
      : null;

    if (
      raw === "persistent" ||
      raw === "sticky" ||
      persistentFlag === "1" ||
      persistentFlag === "true" ||
      persistentFlag === ""
    ) {
      mode = "persistent";
    }
  } catch {
    // Malformed query string — fall back to normal.
  }

  cachedMode = mode;
  console.log(`[Overlay] chat mode: ${mode}`);
  return mode;
}

export function isPersistent() {
  return chatMode() === "persistent";
}

/* ---------------------------------------------------------
   Header toggle

   The header (logo, GIVERS Watching Now, date) is useful on
   most scenes but awkward to crop around on others. Turn it
   off per browser source:

     /overlay/chat/?key=YOUR_KEY&header=no

   Accepts no / off / 0 / false / hide. Anything else, or the
   parameter being absent, leaves the header on — so existing
   URLs are unaffected.
--------------------------------------------------------- */
let cachedHeader = null;

export function showHeader() {
  if (cachedHeader !== null) return cachedHeader;

  let show = true;

  try {
    const raw = (new URLSearchParams(location.search).get("header") || "")
      .toLowerCase()
      .trim();

    if (["no", "off", "0", "false", "hide", "none"].includes(raw)) show = false;
  } catch {
    // Malformed query string — keep the header.
  }

  cachedHeader = show;
  console.log(`[Overlay] header: ${show ? "on" : "off"}`);
  return show;
}

function trimBacklog() {
  const container = document.getElementById("messages");
  if (!container) return;

  while (container.children.length > MAX_PERSISTENT_MESSAGES) {
    container.firstElementChild?.remove();
  }
}

/**
 * Schedule an element's exit, honouring the current mode.
 *
 * In normal mode the element gets `exitClass` after `delay` and
 * is removed once the animation finishes. In persistent mode it
 * is left alone, and the backlog is trimmed instead.
 *
 * @param {HTMLElement} element
 * @param {object}      [options]
 * @param {string}      [options.exitClass="fade-out"]
 * @param {number}      [options.delay=45000]
 */
export function scheduleExit(element, options = {}) {
  if (!element) return;

  const {
    exitClass = "fade-out",
    delay = DEFAULT_EXIT_DELAY_MS
  } = options;

  if (isPersistent()) {
    trimBacklog();
    return;
  }

  setTimeout(() => removeWhenAllowed(element, exitClass), delay);
}

/* ---------------------------------------------------------
   Exits wait while the lane is scrolled back.

   Without this, scrolling up to read a message you missed
   would be pointless: it would fade out from under you at the
   45s mark, and everything above it would shuffle down as its
   neighbours went too.

   So a due element parks in a pending set instead, and leaves
   when the lane returns to the bottom. Nothing accumulates
   invisibly — these are elements that were already on their way
   out, just held.

   In OBS this never engages: scroll-back is off there, so
   isScrolledBack() is always false and this is a straight
   passthrough to the original behaviour.
--------------------------------------------------------- */
const pendingExits = new Set();

function removeWhenAllowed(element, exitClass) {
  if (!element.isConnected) return;

  if (isScrolledBack()) {
    pendingExits.add({ element, exitClass });
    return;
  }

  element.classList.add(exitClass);
  setTimeout(() => element.remove(), EXIT_ANIMATION_MS);
}

window.addEventListener("gac:scroll-resumed", () => {
  if (pendingExits.size === 0) return;

  const due = [...pendingExits];
  pendingExits.clear();

  for (const { element, exitClass } of due) {
    removeWhenAllowed(element, exitClass);
  }
});
