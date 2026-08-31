# Fixtures

Real captured payloads, kept verbatim.

Every recurring bug in this project has had the same shape: a parser
written against an assumed payload, or against a *test* payload, which
turned out not to match the real one. The raid name took eight
attempts. The Blaze duplicate took four. A Volts amount rendered as 0
and by the time we went looking for the payload the ring buffer had
already evicted it.

A captured frame ends those arguments in one read. That is what this
directory is for.

**Do not edit these files.** Their value is that they are exactly what
arrived on the wire. Reformat one and it becomes a guess again.

---

## `beam-capture.txt`

Raw SSE from Beam's unified chat stream, captured 14 August 2026 from

```
https://beamstream.gg/api/chat-ng/api/v1/rooms/625942989834817536/stream
```

76 lines. Contains `init`, `keepalive` and `messages` events, and
messages from six platforms:

| senderType | count |
|---|---:|
| `beam` | 12 |
| `kick`, `pilled`, `twitch`, `velora`, `youtube` | 1 each |

### What it settles

- **Badge shape.** `senderMeta.badges` is an array of OBJECTS,
  `[{"type":"owner"}]`, not strings. `beamBadgesToRoles()` in
  `beamTransform.js` exists because of this, and this file is the
  evidence for it.
- **Avatar shape.** `senderMeta.avatarUrl` is a bare UUID for Beam's
  own users and an absolute URL for relayed platforms — the split
  `resolveAvatar()` handles.
- **`senderType` is the platform key**, and it is Beam's name for the
  platform rather than ours. Blaze arrives as `blazestream`, which is
  why `PLATFORM_ALIASES` exists.
- **The Quill Delta `ops` structure** that `deltaToHtml()` parses.

### What it does NOT contain

No `blazestream` — this predates Beam relaying Blaze. And no
`facebook`, which is *weak* evidence about whether Beam relays
Facebook chat at all, but not proof: the capture is a few minutes long
and there may simply have been no Facebook comment in it. The open
question is recorded here rather than treated as answered.

Checked for credentials before committing: no tokens, no secrets. Beam
usernames and avatar ids are public chat content.
