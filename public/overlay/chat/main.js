// public/overlay/chat/main.js

/* ---------------------------------------------------------
   EVERY IMPORT CARRIES ?v=25.

   Only this file's <script src> is version-busted by
   index.html. Its imports are plain paths, so a browser is free
   to pair a brand-new main.js with a cached copy of any module
   it imports.

   That is not theoretical — it is what broke GoLightStream:
   transparency worked because the cached module already did
   that, while the compositor flag it was meant to set did not
   exist in that copy. Audio stayed dead and no diagnostic
   arrived, with the deployed code looking perfectly correct.

   Worse, a cached module MISSING an export named here fails the
   whole graph and the overlay renders nothing.

   So bump this number with the one in index.html, together.
--------------------------------------------------------- */

import { scaleOverlay } from "./modules/scale.js?v=26";
import { isIOSDevice, createAudioUnlockButtons, unlockAudioOnly } from "./modules/audio.js?v=26";
import { showVoiceSelector } from "./modules/tts.js?v=26";
import { fetchRewardSounds, reportToWorker } from "./modules/rewardSounds.js?v=26";
import { setupSocket } from "./modules/websocket.js?v=26";

// ⭐ Blaze chat (own Socket.IO connection — see modules/blaze.js)
import { setupBlazeChat } from "./modules/blaze.js?v=26";

// ⭐ Load date into header (OBS-only)
import { loadCurrentDate } from "./modules/currentDate.js?v=26";

// ⭐ Viewer count + header initializer
import { setupHeader } from "./modules/header.js?v=26";

// ⭐ Header on/off via ?header=no
import { showHeader } from "./modules/chatMode.js?v=26";

// ⭐ ?opacity=none — transparency for compositors that, unlike
//    OBS, do not inject a transparent background themselves.
import { applyTransparency } from "/overlay/shared/overlayTransparency.js?v=26";

// ⭐ Scroll-back in the browser / iPad (never OBS)
import { initChatScroll } from "./modules/chatScroll.js?v=26";

async function initOverlay() {
  /* ---------------------------------------------------------
     ⭐ Header toggle — applied before anything paints so the
     lane never renders at the wrong height and then jumps.
  --------------------------------------------------------- */
  const headerOn = showHeader();
  if (!headerOn) document.body.classList.add("header-off");

  /* ---------------------------------------------------------
     ⭐ Transparency, and the compositor flag it implies.

     THE FLAG IS SET HERE, NOT IN THE MODULE, because only this
     file's URL carries a version:

       <script src="main.js?v=26">      busts the cache
       import "./modules/foo.js"        does NOT

     So a browser can run a brand-new main.js against a cached
     copy of an imported module. That is exactly what happened in
     GoLightStream: transparency worked (the old module already
     did that) while the flag it was supposed to set did not
     exist yet, so audio stayed broken and no beacon arrived.

     applyTransparency() has always returned true when it
     applies, so reading its result works against either copy.
  --------------------------------------------------------- */
  if (applyTransparency() === true) {
    window.gacCompositorMode = true;
  }

  /* TEMPORARY — one beacon on load, so we can tell whether the
     GoLightStream layer is reaching this code at all. Without
     it, silence in the tail is ambiguous: no sound played, or
     the page never ran. */
  reportToWorker("overlay loaded");

  /* ---------------------------------------------------------
     ⭐ Scroll-back. Set up before any message can arrive, so
     the lane is already following the bottom when the first
     one lands rather than jumping once it initialises.
  --------------------------------------------------------- */
  initChatScroll();

  // ⭐ Audio unlock
  if (isIOSDevice()) {
    createAudioUnlockButtons(showVoiceSelector);
  } else {
    unlockAudioOnly();
  }

  /* ---------------------------------------------------------
     ⭐ Brave/iOS Fix #1 — Delay heavy initializers
     Prevents Brave “Wait or Force Reload?” and iOS stalls.
  --------------------------------------------------------- */
  setTimeout(() => {
    /* ---------------------------------------------------------
       ⭐ ORDER MATTERS, and it is not the obvious one.

       Chat comes first. It used to sit behind
       `await fetchRewardSounds()` — a call to Velora's API — so
       any wobble at their end left us with an overlay showing no
       messages and no clock, with nothing wrong on our side.

       Nothing that isn't chat gets to run before chat, and
       nothing optional gets to be awaited on the way there.
    --------------------------------------------------------- */
    run("socket", () => setupSocket());        // Velora + Beam via the worker
    run("blaze", () => setupBlazeChat());      // direct: Socket.IO can't run in workerd

    /* ---------------------------------------------------------
       ⭐ Header systems — date, viewer count.

       Skipped entirely when the header is off. setupHeader()
       polls /api/viewers on a timer, so this isn't just
       cosmetic: a headerless source would otherwise keep
       requesting a viewer count nothing displays.
    --------------------------------------------------------- */
    if (headerOn) {
      run("date", () => loadCurrentDate());
      run("header", () => setupHeader());
    }

    /* Optional, and deliberately last: reward sounds are the
       only thing lost if Velora is unavailable. Not awaited by
       anything. */
    run("rewardSounds", () => fetchRewardSounds());
  }, 120); // 100–150ms is the sweet spot for Brave/iOS
}

/* ---------------------------------------------------------
   ⭐ One initialiser must never take down the others.

   Each of these is independent: the socket doesn't need the
   clock, the clock doesn't need Blaze. Isolating them means a
   failure costs exactly the feature that failed, and says so in
   the console instead of leaving a blank overlay to explain.
--------------------------------------------------------- */
function run(label, fn) {
  try {
    const result = fn();

    // Catch async rejections too — a returned promise that
    // rejects would otherwise be an unhandled rejection.
    if (result && typeof result.catch === "function") {
      result.catch((err) =>
        console.error(`[Overlay] ${label} failed:`, err?.message || err)
      );
    }
  } catch (err) {
    console.error(`[Overlay] ${label} failed:`, err?.message || err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  scaleOverlay();
  initOverlay();
});
