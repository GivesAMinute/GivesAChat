// public/overlay/chat/modules/debugPanel.js

/* ---------------------------------------------------------
   An on-screen console, for the device that has no console.

   Channel point audio fails on the iPad and works on the
   iPhone. Every tool that would answer why — the BAILED lines,
   the play() rejection, the watchdog — writes to a console
   nobody can read on an iPad without a Mac, a cable and Safari's
   developer settings.

   Two fixes have now been made by reasoning about which log line
   WOULD have appeared. Both were plausible and neither worked.
   This stops that: the log appears on the device, in the overlay,
   while it is failing.

   Off unless ?debug=1 is in the URL. Nothing is hooked, nothing
   is rendered, and console behaviour is untouched otherwise, so
   the live overlay cannot be affected by it.
--------------------------------------------------------- */

const MAX_LINES = 24;

/* ---------------------------------------------------------
   Only our own messages. The browser's own noise — CORS
   warnings, favicon 404s, Discord's socket spam — would push the
   useful lines off the top within seconds.

   ⚠️ CASE-INSENSITIVE, and that matters.

   This was written case-sensitive and the chat payload log is
   console.log("[OVERLAY] incoming chat payload:", …) in capitals,
   so every chat line was silently discarded by the one tool
   built to show them. Chasing a missing bot message, the panel
   showed nothing and the obvious reading was "no message
   arrived" — when the truth was "the panel refused to print it".

   A diagnostic that hides evidence is worse than no diagnostic,
   because it answers confidently and wrongly.
--------------------------------------------------------- */
const INTERESTING =
  /^\[(RewardSounds|TTS|Audio|Overlay|Overlay WS|Streamlabs|BEAM|CLAIM|Velora)\]/i;

export function setupDebugPanel() {
  let on = false;
  try {
    on = new URLSearchParams(location.search).get("debug") === "1";
  } catch {
    return;
  }
  if (!on) return;

  const box = document.createElement("div");
  box.id = "gac-debug";
  Object.assign(box.style, {
    position: "fixed",
    left: "8px",
    bottom: "8px",
    width: "min(620px, calc(100vw - 16px))",
    maxHeight: "42vh",
    overflowY: "auto",
    zIndex: "2147483647",
    background: "rgba(0,0,0,0.86)",
    color: "#d9ffd9",
    font: "13px/1.35 ui-monospace, Menlo, Consolas, monospace",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #2b5",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    pointerEvents: "auto"
  });

  const add = (kind, args) => {
    const text = args
      .map((a) => {
        if (typeof a === "string") return a;

        /* A chat payload stringifies to several hundred
           characters of html and badge arrays, which fills the
           panel with one message. Summarised to the fields that
           identify it. */
        if (a && typeof a === "object" && a.type === "chat") {
          return `{${a.platform} ${a.username} avatar=${a.avatar ? "yes" : "NO"} ` +
                 `badges=${JSON.stringify(a.badges || [])} ` +
                 `"${String(a.html || "").replace(/<[^>]+>/g, "").slice(0, 40)}"}`;
        }

        try { return JSON.stringify(a); } catch { return String(a); }
      })
      .join(" ");

    if (!INTERESTING.test(text)) return;

    const line = document.createElement("div");
    line.textContent =
      new Date().toLocaleTimeString([], { hour12: false }) + "  " + text;

    line.style.color =
      kind === "error" ? "#ff8f8f" : kind === "warn" ? "#ffd27f" : "#d9ffd9";

    box.appendChild(line);
    while (box.childElementCount > MAX_LINES) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
  };

  for (const kind of ["log", "warn", "error"]) {
    const original = console[kind].bind(console);
    console[kind] = (...args) => {
      original(...args);
      try { add(kind, args); } catch { /* never break the page */ }
    };
  }

  /* ---------------------------------------------------------
     A tap reports the audio state directly, which is the thing
     we cannot otherwise see: whether the unlock survived,
     whether the pool exists, and whether the busy counter has
     leaked — the counter that stops TTS when it does.
  --------------------------------------------------------- */
  box.addEventListener("click", () => {
    console.log(
      `[Audio] state — unlocked=${!!window.gacAudioUnlocked} ` +
      `pool=${window.rewardAudioPool?.length ?? "none"} ` +
      `playingCount=${window.rewardAudioPlayingCount ?? 0} ` +
      `queued=${window.rewardSoundQueue?.length ?? 0} ` +
      `ttsSpeaking=${!!window.ttsSpeaking} ttsPending=${!!window.ttsPending} ` +
      `synth.speaking=${!!window.speechSynthesis?.speaking} ` +
      `enableChatTTS=${!!window.enableChatTTS} ` +
      `obs=${!!window.obsBrowserSource}`
    );
  });

  document.body.appendChild(box);
  console.log("[Overlay] debug panel on — tap it to dump audio state");
}
