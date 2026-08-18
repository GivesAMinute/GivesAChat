// public/overlay/chat/modules/chatScroll.js

/* ---------------------------------------------------------
   Scroll-back for the chat lane

   In a browser or on the iPad you can miss a message as it
   pushes up and out of the lane. This lets you scroll up to
   read it — no scrollbar, just the gesture.

   THREE THINGS MAKE THIS WORK, and none of them is the scroll
   itself.

   1. IT MUST NOT AFFECT OBS. The lane is a browser source with
      pointer-events off so clicks pass through to the scene.
      Turning that on for OBS would let a stray scroll shift
      chat mid-broadcast. Scroll-back is therefore disabled
      whenever OBS is detected.

   2. SCROLLING UP MUST FREEZE THE LANE. Normal mode removes a
      message from the DOM 45 seconds after it arrives. Without
      this, the message you scrolled up to read would vanish
      while you were reading it, and the ones above it would
      shuffle down. So exits are PAUSED while you are scrolled
      away from the bottom, and resume when you return.

   3. NEW MESSAGES MUST NOT YANK YOU BACK. The lane auto-follows
      only while you are already at the bottom. Scroll up and it
      stays put, however much chat arrives.

   The lane still holds only what normal mode would have kept —
   roughly the last 45 seconds — so this is "catch the one that
   just went past", not full history. Add ?mode=persistent for
   a longer backlog.
--------------------------------------------------------- */

/* How far from the bottom counts as "scrolled back". A few
   pixels of slack: sub-pixel rounding and momentum scrolling on
   iOS both leave scrollTop slightly off its true maximum, and
   without this the lane would think you had scrolled up when
   you hadn't. */
const BOTTOM_THRESHOLD_PX = 48;

let container = null;
let enabled = false;
let scrolledBack = false;

/* ---------------------------------------------------------
   OBS detection

   window.obsstudio is injected into every OBS browser source
   and is the reliable signal. The user-agent check is a
   secondary net for older builds that don't inject it.

   Overridable per source with ?scrollback=yes|no, so a browser
   that somehow trips the detection can still be fixed without
   a deploy.
--------------------------------------------------------- */
function inOBS() {
  if (typeof window.obsstudio === "object" && window.obsstudio) return true;
  return /\bOBS\b/i.test(navigator.userAgent || "");
}

export function scrollbackEnabled() {
  try {
    const raw = (new URLSearchParams(location.search).get("scrollback") || "")
      .toLowerCase()
      .trim();

    if (["no", "off", "0", "false"].includes(raw)) return false;
    if (["yes", "on", "1", "true"].includes(raw)) return true;
  } catch {
    // Malformed query string — fall through to detection.
  }

  return !inOBS();
}

/** True while the viewer has scrolled away from the bottom. */
export function isScrolledBack() {
  return enabled && scrolledBack;
}

function atBottom() {
  if (!container) return true;
  const distance =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= BOTTOM_THRESHOLD_PX;
}

function toBottom() {
  if (container) container.scrollTop = container.scrollHeight;
}

export function initChatScroll() {
  if (!scrollbackEnabled()) {
    console.log("[Overlay] scroll-back: off (OBS or disabled)");
    return;
  }

  container = document.getElementById("messages");
  if (!container) return;

  enabled = true;
  document.body.classList.add("scrollback");
  console.log("[Overlay] scroll-back: on");

  container.addEventListener(
    "scroll",
    () => {
      const back = !atBottom();
      if (back === scrolledBack) return;

      scrolledBack = back;
      document.body.classList.toggle("scrolled-back", back);

      /* Returning to the bottom releases every exit that came
         due while you were reading. They leave together, which
         looks deliberate rather than like a backlog draining. */
      if (!back) window.dispatchEvent(new CustomEvent("gac:scroll-resumed"));
    },
    { passive: true }
  );

  /* ---------------------------------------------------------
     Follow new messages only when already at the bottom.

     A MutationObserver rather than a hook in the renderer:
     every platform appends through a different path, and this
     catches all of them without touching any of them.
  --------------------------------------------------------- */
  new MutationObserver(() => {
    if (!scrolledBack) toBottom();
  }).observe(container, { childList: true });

  toBottom();
}
