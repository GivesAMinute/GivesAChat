# Adding a platform to GivesAChat

Notes from doing this six times (Beam, Blaze, Arena, VPZONE, Velora,
Odysee). Read before starting the seventh.

## 1. Capture real data before writing a parser

Never write a transform from documentation alone, and never from a
guess. Get the actual frames first:

- DevTools → Network → **WS** filter → copy the Request URL and a few
  message frames
- Then **Fetch/XHR** for the REST calls around it

Every parser written ahead of real data has been wrong.

## 2. If their client renders it, the answer is in their bundle

**This is the big one.** It cost six rounds on Odysee emotes.

When a platform renders something correctly — emotes, stickers, badge
artwork, colour palettes — the mapping exists as data inside their
web client. Go and read it instead of reverse-engineering it from
samples:

1. DevTools → `Cmd+Option+F` (global search, *not* the Network tab)
2. Search for a known value — a filename, an emote code, a CDN path
3. The file that matches is the manifest

Odysee's sticker and emote lists turned out to be hardcoded arrays in
`assets/*.js`. I had spent six rounds inferring rules from samples;
each round fixed some tokens and broke others, because there was no
rule. `:cry_1:` → `cry@2x.png` but `:confused_2:` → `confused@2x.png`
— the same suffix meaning opposite things.

Evaluate their code to generate the map rather than transcribing it.
Eighty hand-typed entries is eighty chances at a silent typo.

## 3. Build probe endpoints with deliberate control paths

An authenticated diagnostic route beats guessing. Always include a
control that **must fail** — a fake emote name, a nonexistent path.

Without it, a wall of `200`s is meaningless. With it, Blaze was proven
to have no emotes endpoint and Odysee's CDN was shown to answer `403`
(not `404`) for a miss — which would have made `res.ok` treat every
miss as a hit.

## 4. Watch for the silent failure mode

The dangerous bugs are the ones with no error:

- **Odysee's socket** is keyed to a per-stream claim id. Hard-coding
  it connects fine and delivers nothing, forever.
- **Beam relaying a platform we already carry** would double every
  message mid-stream with no code change to explain it. Hence
  `IGNORED_SENDER_TYPES` — add a new platform there the same day you
  add it to the overlay.
- **Odysee timestamps are seconds**, not ms. Read as ms that's 1970,
  pinning every message to the top of the lane.

## 5. Things that have bitten us more than once

- Cloudflare `fetch` needs `http(s)` for a WS upgrade, never `wss://`
- Un-awaited subrequests are cancelled — use `ctx.waitUntil`
- Static assets bypass the Worker; headers go in `public/_headers`
- `currentColor` does not inherit into an SVG loaded via `<img src>`
- One missing import kills the whole overlay module graph
- Tokens/credentials go in via `npx wrangler secret put`, never in
  chat, never in the repo

## 6. Cost control

Requests are basically free — 1M/month, then $0.15/million. **Duration
is the entire bill.** A Durable Object is billed for wall-clock time
it spends resident, at 128 MB:

```
1 second resident   =     0.125 GB-s
1 day resident 24/7 =    10,800 GB-s
Free allowance      =   400,000 GB-s / month  =  37 object-days
```

**One object left resident round the clock eats 81% of the monthly
free tier.** With seven objects that arithmetic gets away from you
fast. Divide any Duration figure by 10,800 to read it as "object-days
resident" — it turns an abstract number into an obvious one.

Cache anything resolved from a third party — avatars, emote paths —
and cache the *misses* too, or a typo'd token re-probes on every
message.

### Push, don't poll

Four platform rooms each polled ChatRoom every 30s asking "is anyone
watching?". Staggered, that woke ChatRoom every ~7 seconds forever.
Hibernation needs a quiet window, so it never got one and billed
around the clock.

ChatRoom now pushes `/idle` on its last disconnect. Wakes went from
11,520/day to 1,153. **The object being polled pays for the poll** —
if something needs to know when state changes, have the owner tell it.

Keep an infrequent poll as a safety net anyway (5 min), in case the
notification is never sent: an eviction mid-close, a deploy.

### A send-only socket is not a consumer

**The subtlest bug in this whole project.** The popups overlay opens
`/ws/popups` *and* a second `/ws/chat` socket — send-only, used to
push reward cards into the lane. It reads nothing.

The worker couldn't tell it from a real chat overlay, so opening the
popups overlay fired all four platform wakes and started Beam's SSE,
Arena's poller and the VPZONE and Odysee sockets — four upstream
connections feeding a client that ignored every one of them. Six
objects resident for as long as popups was open.

The tell was in the metrics long before the cause: PopupRoom and
ChatRoom showed *identical* duration on wildly different request
counts. Same page opens both, so they live and die together.

Fixing it needed two halves, and one alone would have been worse than
the bug:

1. the socket declares `?role=popups`; the worker skips the wakes
2. ChatRoom excludes it from `/clients` and from the disconnect
   notification

Without (2) the rooms would start correctly and then never stop,
because a popups overlay left open still counted as a viewer.

**Generalise it:** before wiring a connection to "someone is
watching", ask whether that client actually *reads* anything.

### The Errors column is mostly WebSocket closes

A WebSocket upgrade is recorded as `Canceled` when the socket
eventually closes, and that lands in Errors. Only objects accepting
inbound WebSockets show any, in proportion to how much of their
traffic is WebSocket — ChatRoom 5–34%, PopupRoom 83–87%, everything
else 0–0.4%.

Not a fault. Don't chase it.

---

**Outstanding:** `keys/ssh-key-2026-07-27.key` is a tracked private
key in a public repo, present in history at `8b88c42` and `8da8f20`.
Deleting the file is not enough — the key needs rotating wherever it
is authorised.
