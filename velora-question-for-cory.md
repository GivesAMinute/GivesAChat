# Question for Cory (Velora) — claim alert template variables

Hey mate, building a custom chat/alert overlay off the Velora webhooks and
I've hit one gap. Rather than reverse-engineer it, easier to just ask you
directly.

## What I'm receiving

When someone claims 1st or 2nd to the stream, I get
`channel.channel_points_redemption` at my webhook. The `cardDesign` comes
through with the templates unsubstituted:

```json
"cardDesign": {
  "textLine1": { "content": "{username} was the 1st GIVER to this stream!" },
  "textLine2": { "content": "This is their {times} time claiming {place}!" }
}
```

Alongside that I get `username`, `displayName`, `avatarUrl`, `rewardTitle`
("First (1st)"), `rewardId`, `rewardCost`, `alertSoundUrl`, `alertDuration`,
`alertAnimation`, `alertPosition`.

So I can fill `{username}` from `displayName` and `{place}` from
`rewardTitle`. There is no value anywhere on the payload for `{times}`.

## What I actually need

1. **Where does `{times}` come from?** Is the claim count available on any
   webhook payload, REST endpoint, or socket event I can reach? If it's on
   an endpoint, what's the path and which scope does it need? I have
   `channel:points:read` approved.

2. **Is there a separate event carrying the already-rendered text?** Your
   own chat shows "CompTech has been 1st 9 times!", which is different
   wording to `textLine2` above — so I assume that string is composed
   somewhere other than from this template. If there's an event that
   already has it substituted, I'd rather consume that than rebuild it.

3. **Is there a full list of the template variables** valid in
   `cardDesign.textLine1/textLine2`, and which payload field each maps to?
   I'd like to handle them all properly rather than special-casing the
   three I've seen.

4. **Should `{times}` be on the webhook payload at all?** If it's simply
   missing rather than intentionally client-side, happy to log it as a bug
   — it's the only placeholder I can't resolve.

No urgency, and thanks — the webhook side has been solid otherwise.
