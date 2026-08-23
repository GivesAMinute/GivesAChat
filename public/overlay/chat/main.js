// public/overlay/chat/main.js

/* ---------------------------------------------------------
   DO NOT put ?v= on these imports.

   It was tried, to defeat a stale cached module, and it broke
   audio completely on every URL.

   A module's identity is its URL. Importing the same file as
   "./modules/rewardSounds.js?v=27" here and as
   "./rewardSounds.js" from rewardRenderer.js loads it TWICE —
   two separate instances, each with its own state. So
   fetchRewardSounds() filled the sound map in one copy while
   playRewardSound() read an empty map in the other, and
   unlockAudioOnly() set audioUnlocked in one instance while
   rewardSounds.js checked it in another.

   Cache freshness is handled properly by public/_headers,
   which sets no-cache, must-revalidate on /overlay/*. If a
   stale module is ever suspected again, fix it there — never
   by making one importer's URL differ from another's.
--------------------------------------------------------- */

import { scaleOverlay } from "./modules/scale.js";
import { isIOSDevice, createAudioUnlockButtons, unlockAudioOnly } from "./modules/audio.js";
import { showVoiceSelector } from "./modules/tts.js";
import { fetchRewardSounds } from "./modules/rewardSounds.js";
import { setupSocket } from "./modules/websocket.js";

// ⭐ Blaze chat (own Socket.IO connection — see modules/blaze.js)
import { setupBlazeChat } from "./modules/blaze.js";

// ⭐ Load date into header (OBS-only)
import { loadCurrentDate } from "./modules/currentDate.js";

// ⭐ Viewer count + header initializer
import { setupHeader } from "./modules/header.js";

// ⭐ Header on/off via ?header=no
import { showHeader } from "./modules/chatMode.js";

// ⭐ ?opacity=none — transparency for compositors that, unlike
//    OBS, do not inject a transparent background themselves.
import { applyTransparency } from "/overlay/shared/overlayTransparency.js";

// ⭐ Scroll-back in the browser / iPad (never OBS)
import { initChatScroll } from "./modules/chatScroll.js";

async function initOverlay() {
  /* ---------------------------------------------------------
     ⭐ Header toggle — applied before anything paints so the
     lane never renders at the wrong height and then jumps.
  --------------------------------------------------------- */
  const headerOn = showHeader();
  if (!headerOn) document.body.classList.add("header-off");

  /* ---------------------------------------------------------
     ⭐ Transparency, and the compositor flag it implies.

     The flag is set here rather than inside the module so that
     an older cached copy of overlayTransparency.js still works —
     it has always returned true when it applies.
  --------------------------------------------------------- */
  if (applyTransparency() === true) {
    window.gacCompositorMode = true;
  }

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
