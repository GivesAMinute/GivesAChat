// public/overlay/shared/overlayTransparency.js

/* ---------------------------------------------------------
   ?opacity=none — force a fully transparent page

   OPT-IN, DELIBERATELY.

   OBS injects its own CSS into every browser source:

     body { background-color: rgba(0,0,0,0); margin: 0px auto;
            overflow: hidden; }

   so an overlay looks transparent there whatever its own CSS
   says. Nothing else does that. GoLightStream renders the page
   as written, so the chat overlay's `background-color: #131313`
   showed up as a full-screen grey rectangle covering the video
   and every layer beneath it.

   The obvious fix — make the page transparent by default — was
   tried and reverted, because it breaks every OTHER use at
   once: read on a monitor or in the public pop-out, transparent
   renders WHITE and the chat becomes unreadable.

   So transparency is requested per URL instead. Add
   ?opacity=none to the two sources GoLightStream loads and
   nothing else changes:

     .../overlay/chat/?key=…&opacity=none
     .../overlay/popups/?key=…&opacity=none

   OBS, the iPad and bjwok.com/chat keep their current URLs and
   behave exactly as they do today.
--------------------------------------------------------- */

const TRANSPARENT_VALUES = new Set([
  "none",
  "0",
  "off",
  "no",
  "false",
  "clear",
  "transparent"
]);

/**
 * Apply transparency if the URL asks for it.
 *
 * @returns {boolean} whether transparency was applied
 */
export function applyTransparency() {
  let raw = "";

  try {
    raw = (new URLSearchParams(location.search).get("opacity") || "")
      .toLowerCase()
      .trim();
  } catch {
    return false;   // malformed query string — leave the page alone
  }

  if (!raw) return false;

  if (!TRANSPARENT_VALUES.has(raw)) {
    /* Anything unrecognised is ignored rather than guessed at. A
       typo should leave the overlay exactly as it is, not paint
       it something arbitrary on a live stream. */
    console.warn(`[Overlay] unrecognised ?opacity=${raw} — ignored`);
    return false;
  }

  /* BOTH elements. body alone is usually enough, but the root
     element's background is what actually paints the canvas,
     and only OBS supplies a transparent default for us. */
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";

  /* Marker class, so a stylesheet can opt specific pieces out of
     their own backgrounds later without another URL flag. */
  document.documentElement.classList.add("opacity-none");
  document.body.classList.add("opacity-none");

  /* ---------------------------------------------------------
     COMPOSITOR MODE

     Anything asking for transparency is a broadcast compositor,
     not a person reading a page — that is the whole reason the
     flag exists. Which means the same thing OBS gets should
     apply: no unlock UI, and audio played the simple way.

     Scoped to this flag on purpose. The chat overlay's reward
     sounds are gated behind an audio pool that is only built in
     the OBS branch or on an iOS unlock tap, so in GoLightStream
     the pool stayed empty and every sound was dropped before it
     was attempted. The popups overlay has no such gate, which is
     exactly why its audio worked there and chat's did not.

     Only URLs carrying ?opacity=none see this. OBS, the iPad and
     the public pop-out are untouched.
  --------------------------------------------------------- */
  window.gacCompositorMode = true;

  console.log("[Overlay] transparency: on (?opacity=none), compositor mode");
  return true;
}
