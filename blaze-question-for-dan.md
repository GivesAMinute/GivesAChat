# Question for Dan (Blaze) — resolving emote IDs to image URLs

Hey Dan, I've built a multi-platform chat overlay and wired up Blaze via
the Events API. App Access Token, `channel.chat.message` over Socket.IO —
worked first try, and the docs were good to build against. Avatars,
roles and `isOwner` all came through clean.

One thing I can't resolve: emote images.

## The problem

`channel.chat.message` embeds an emote token in the message text:

```
"message": "emote test[emote:2f733d36-16bb-4a05-bb3f-1d7e73634a6e]"
```

That looked like a CDN id, so I built the URL directly. It 404s.

Inspecting your own web client, that same emote (`:ANGRYPYRO2:`) renders
from a completely different uuid:

```html
<img alt=":ANGRYPYRO2:"
     src="https://cdn.blaze.stream/uploads/emote/8e447717-a24f-4748-aa6c-e9a6d5b02071.png">
```

```
wire token   2f733d36-16bb-4a05-bb3f-1d7e73634a6e   (emote id?)
image file   8e447717-a24f-4748-aa6c-e9a6d5b02071   (asset id?)
```

Same emote, two different identifiers. So the image URL can't be built
from the event payload, and I can't find an emotes endpoint under
Channels, Users, Chat, Categories or Moderation to map between them.

## What would unblock me

1. **Is there an endpoint that resolves an emote id to its image?**
   Even an undocumented one is fine — I only need id in, URL out. A
   channel emote list I could fetch and cache server-side would be ideal,
   since it also covers global emotes and emotes from other channels.

2. **If not, is one planned?** Happy to strip the tokens in the meantime
   rather than render them raw — I just don't want to build a manual
   lookup table if a proper endpoint is a week away.

Two smaller things while I'm here:

- Is `cdn.blaze.stream/uploads/emote/<uuid>.png` a stable public path I
  can rely on, or an implementation detail that may change?
- Are emote ids globally unique across Blaze, or scoped per channel?
  That decides whether a cache needs keying by channel.

No urgency — everything else works and I'm live with it. Emotes just
render as nothing for now. Thanks for the API, it's a nice one to build on.
