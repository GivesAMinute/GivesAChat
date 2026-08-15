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

  setTimeout(() => {
    element.classList.add(exitClass);
    setTimeout(() => element.remove(), EXIT_ANIMATION_MS);
  }, delay);
}
