# Adding a platform to GivesAChat

Notes from doing this eight times (Beam, Blaze, Arena, VPZONE, Velora,
Odysee, BitChute, Facebook). Read before starting the ninth.

## 1. Capture real data before writing a parser

Never write a transform from documentation alone, and never from a
guess. Get the actual frames first:

- DevTools → Network → **WS** filter → copy the Request URL and a few
  message frames
- Then **Fetch/XHR** for the REST calls around it

Every parser written ahead of real data has been wrong.

### Capture both directions of a WebSocket

**A capture of only the frames the server sends is half a capture.**
In Chrome: click the socket → **Messages** → change the dropdown from
*All Messages* to **Send**.

BitChute cost an entire debugging session on this. The socket
connected, the token was accepted, an identity was issued for the
correct thread — and no messages ever arrived, with no error. The
missing piece was one frame the client sends and nothing echoes:

```
42["join_room","<channel id>"]
```

Inbound frames are the ones that get pasted around, because they are
the interesting ones. The outbound frames are the ones that make the
inbound frames happen.

### Read the list of requests, don't guess endpoint names

Looking for BitChute's socket token, I guessed `api/beta/video`. It
returned **200** — and was the wrong endpoint. An older route still
answering, with none of the data we needed.

Thirty seconds of reading the Fetch/XHR list gave the real answer:
`api/beta9/video` for metadata (note the **9**), and
`api/beta/apps/commentfreely/video`, which returns the signed socket
token in an `auth` field. Neither was guessable.

A 200 from a guessed URL is not evidence. See §3.

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

**The control ends the search as often as it starts it.** Facebook's
documented SSE endpoint returned `400` for every field combination we
tried. Six variants, identical errors — which reads as "wrong
parameters, keep permuting". Then a control asking for **video id
`1`** returned the *same* error. A nonexistent broadcast answering
identically to a real one meant the endpoint never evaluated the
request at all, and no parameter would ever have fixed it. We switched
to polling and had chat working within the hour.

Budget one call for the control. It is the cheapest call you will
make.

### Read the error page, not its stylesheet

Stripping tags with `replace(/<[^>]+>/g, " ")` leaves the CONTENT of
`<style>` and `<script>` behind, so the "error message" you log is a
font stack. Remove those elements *and their contents* first:

```js
.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, " ")
.replace(/<[^>]+>/g, " ")
```

Cost a full round trip to notice.

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
- **Authenticated is not subscribed.** BitChute's socket accepted our
  token, put us in the right thread, assigned us a display name and an
  avatar, and sent no messages — because we never emitted `join_room`.
  Connecting successfully proves nothing about whether you will
  receive anything.

- **A requested field coming back ABSENT is a refusal, not an empty
  value.** Facebook dropped `live_status` from every response rather
  than returning it null, and dropped it *silently*. Combined with a
  `(#100) Missing permissions` on a related edge, that was the API
  saying "you may not ask this" — but read on its own it looks like
  the videos simply aren't live. Compare what you asked for against
  what came back, not just the values you got.

The pattern in all five: **the system reports success and does
nothing.** When something silently produces no output, suspect a
missing subscribe, a stale id, or a unit mismatch before suspecting
the parser — the parser at least fails loudly.

### Tell "quiet" apart from "broken"

A reader that is connected with `messageCount: 0` is ambiguous: quiet
room, unhandled event name, or never subscribed. Keep a small ring
buffer of recent raw frames on the status route (`recentFrames` in
`bitchuteRoom.js`) and the three become distinguishable instantly.
This is worth building *before* you need it — it is the difference
between one round trip and six.

Log unrecognised event names rather than dropping them. A platform
adds a feature; you want it in the log, not in a silence.

## 4b. Signed tokens: work out who mints them

Before deciding whether an integration can live in a Durable Object or
has to run in the browser, establish where its credential comes from.

For BitChute the token decoded to JSON with `": "` and `", "`
separators — **`json.dumps` defaults, which `JSON.stringify` never
produces**. That single detail proved it was minted in Python on their
server, therefore fetchable by a Worker, therefore no overlay needed.

Also worth checking: is the signature actually keyed? Hash the payload
and timestamp a dozen plausible ways and compare. If one matches, it's
a checksum. BitChute's didn't match any, across two captures with
identical payloads and differing signatures — so it's HMAC'd with a
key we'll never have, and fetching a real one is the only route. Ten
minutes to rule out, and it decides the architecture.

## 4c. Rate limits can be the design constraint

Most platforms here have no meaningful limit. Facebook does, and it is
far smaller than it looks:

```
Development app:  200 calls/hour  ×  number of app users
                  = 200/hour, because there is exactly one user
```

Polling `live_videos` every 30s is 120 calls/hour — **60% of the
entire budget** spent asking a question almost always answered "no".

Design the cadence against the budget, not against what feels
responsive. And where the budget's shape is uncertain, let the
platform tell you: Facebook returns `x-app-usage` with a `call_count`
percentage on every response. `facebookRoom.js` doubles its own poll
interval past 75% and recovers below 40%, which beats picking a number
and hoping.

## 4d. A documented endpoint is not a working endpoint

Facebook publishes an SSE endpoint for live comments. It is in current
docs, with examples. It returns `400` to us for everything, including
requests it cannot possibly have parsed.

Meta's own sample app for this feature was archived in 2021.

Don't spend a day making the elegant path work when a plain one is
available. Polling the comments edge is slower, costs rate limit and
adds ~15s latency — and it shipped working chat the same hour.

## 5. Things that have bitten us more than once

- Cloudflare `fetch` needs `http(s)` for a WS upgrade, never `wss://`
- Un-awaited subrequests are cancelled — use `ctx.waitUntil`
- Static assets bypass the Worker; headers go in `public/_headers`
- `currentColor` does not inherit into an SVG loaded via `<img src>`
- One missing import kills the whole overlay module graph
- Tokens/credentials go in via `npx wrangler secret put`, never in
  chat, never in the repo
- Percent-encode a token before putting it in a query string. Base64
  can contain `+`, and `+` in a query decodes to a space on nearly
  every server — which corrupts the signature and looks like a
  rejected token
- Delete diagnostic routes once they've done their job. They dump
  third-party response bodies and outlive their usefulness fast
- **A diagnostic that echoes a third-party response can echo a
  credential.** Graph API embeds the caller's access token in its own
  `paging.next` URLs, so `/facebook/probe` leaked a live token into a
  chat window the first time it ran. Redact centrally, match keys
  exactly, and remember tokens hide inside URLs as well as fields

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
