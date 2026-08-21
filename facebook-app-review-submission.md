# Facebook App Review — submission draft

App: GivesAChat (2575242256241936)

Submitting three: pages_read_user_content, pages_read_engagement and
pages_show_list. The third is a dependency Facebook requires alongside
the other two — it is not optional, despite working at Standard Access
for your own Pages.

The same screen recording is used for all three. That is normal: one
recording showing the app's flow demonstrates all three permissions
doing their job in sequence.

Everything between the ===== lines is plain text with no formatting,
ready to copy straight into Facebook's form.


## 1. Description for pages_read_user_content

===================== COPY FROM HERE =====================

GivesAChat is a live-streaming chat overlay built and operated by a single creator for their own Facebook Page, "Gives A Minute". The creator broadcasts simultaneously to Facebook and several other streaming platforms, and this tool merges the chat from all of them into one on-screen panel so the creator can read and respond to their audience while live.

HOW THE PERMISSION IS USED

While the Page is broadcasting, the app resolves the current live video via GET /{page-id}/live_videos and then reads new comments on that broadcast via GET /{live-video-id}/comments, requesting the fields id, message, created_time and from{id,name,picture}. Each comment is displayed on screen for a few seconds, alongside comments from the other platforms the creator streams to, and is then removed.

WHY THE COMMENTER'S NAME AND PICTURE ARE NECESSARY

The purpose of the overlay is for the creator to engage with viewers by name during the broadcast, answering questions, welcoming people and thanking them. Without the "from" field, every comment renders as an unattributed message, so the creator cannot tell who is speaking, who they are replying to, or distinguish between two people talking at once. The comment text alone does not support conversation.

This is Page management in the ordinary sense: the creator reading and responding to comments left on their own Page's content, during the broadcast those comments were left on.

VALUE TO THE PERSON USING THE APP

It removes the need to watch several separate chat windows on separate devices while presenting live. Facebook comments currently appear in the overlay without an author, which makes Facebook the only platform the creator cannot respond to personally.

DATA HANDLING

Comments are relayed to the overlay in real time and are not stored. Nothing is written to a database or a log, no profile of any commenter is built, and no data is shared with any third party or used for advertising or analytics. The only retained data is the creator's own Page access token. The app is used solely by its operator for their own Page. It is not offered to the public and has no other users.

Privacy policy: https://givesachat-cloudflare.benonkoebsch.workers.dev/privacy

====================== TO HERE ======================


## 2. Description for pages_read_engagement

===================== COPY FROM HERE =====================

GivesAChat is a live-streaming chat overlay operated by a single creator for their own Facebook Page, "Gives A Minute". The creator is the Page admin, and the app is used only by them, to administer and engage with their own Page while broadcasting.

HOW THE PERMISSION IS USED

While the Page is live, the app reads the Page's own content to identify the current broadcast, using GET /{page-id}/live_videos and requesting id and status. This is necessary because the live video ID changes with every broadcast and must be resolved at runtime. The app then reads the comments on that broadcast and displays them, with each commenter's name and profile picture, in an on-screen panel the creator watches while presenting.

WHY IT IS NECESSARY

Administering a Page during a live broadcast means reading and responding to what people are saying on it, as it happens. This permission provides two things the app cannot function without: the identity of the current live video, and the follower name and profile picture attached to each comment. Without the former the app cannot locate the broadcast at all. Without the latter, comments render unattributed and the admin cannot tell who is speaking or reply to anyone by name.

VALUE TO THE PERSON USING THE APP

The creator broadcasts to Facebook and several other platforms simultaneously. This tool merges all of those chats into one panel so the Page admin can engage with their Facebook audience without watching a separate window on a separate device while live. Facebook is currently the only platform in that panel whose commenters cannot be identified, which makes it the only one the admin cannot respond to personally.

DATA HANDLING

Comments and profile pictures are relayed to the overlay in real time and are not stored. Nothing is written to a database or log, no profile of any follower is built, no insights or analytics are collected, and no data is shared with any third party or used for advertising. The only retained data is the creator's own Page access token. The app is not offered to the public and has no other users.

Privacy policy: https://givesachat-cloudflare.benonkoebsch.workers.dev/privacy

====================== TO HERE ======================


## 2b. Description for pages_show_list

Facebook requires this one alongside the others — it is a dependency of
the Page permissions, not optional.

===================== COPY FROM HERE =====================

GivesAChat is a live-streaming chat overlay operated by a single creator for their own Facebook Page, "Gives A Minute". Before it can read any chat, it has to establish which Page the creator manages and obtain that Page's access token.

HOW THE PERMISSION IS USED

The creator authorises the app once. The app then calls GET /me/accounts to retrieve the list of Pages they manage, and displays that list back to the creator on the confirmation screen so they can see exactly which Pages the app has connected. The app uses this to verify that the creator administers the Page they broadcast to, and to obtain that Page's access token, which is what allows it to read comments on that Page's live videos.

WHY IT IS NECESSARY

Without this permission the app cannot confirm Page ownership and cannot obtain a Page access token, so it cannot read any chat at all. Every other function of the app depends on this one call.

VALUE TO THE PERSON USING THE APP

It is what connects the app to the correct Page. The creator sees the list of their own Pages on the confirmation screen and can confirm the right one was connected, rather than having to find and paste a Page ID manually.

DATA HANDLING

The app is configured with the single Page the creator streams to. Access tokens for every other Page returned by this call are discarded immediately and never stored. No list of Pages is retained, no data about any Page is shared with third parties, and none is used for advertising or analytics. The app is used solely by its operator for their own Page. It is not offered to the public and has no other users.

Privacy policy: https://givesachat-cloudflare.benonkoebsch.workers.dev/privacy

====================== TO HERE ======================


## 3. What to submit, and what to leave out

The rule that decides every item:

Standard Access already covers everything about YOU. Only data about
OTHER PEOPLE needs review.

Listing your own Pages, resolving your own live video, reading your own
Page's content — all authorised by your token, and you hold a role on
the app, so Standard Access covers them permanently. The single thing
it cannot do is tell you who a viewer is.

Removed from the submission, and why:

| Item | Why not |
|---|---|
| publish_video | We never publish. OBS pushes over RTMP; the API only reads |
| business_management | Read and write on the Business Manager API, entirely unused |
| public_profile | Automatically granted to every app; nothing to review |
| Live Video API | Its allowed usage is publishing live video, which we don't do |


## 4. Screencast

Reviewers want to see the permission in use, in a continuous recording,
with the app visible throughout. Roughly 60 to 90 seconds.

### Set the stage first, so it's one take

1. Add a second Facebook account of your own under App Roles → Testers,
   and accept the invite from that account (developers.facebook.com/requests)
2. Go live on the Gives A Minute Page
3. Open the chat overlay in a plain browser window (not inside OBS —
   it records more legibly)
4. Have the Facebook live post open in a second window, logged in as
   the Tester account, comment box ready
5. Confirm chat is flowing from at least one other platform, so the
   merge is visible

### Shot list

1. The overlay, with messages already arriving from other platforms
2. The Facebook Page, broadcasting — make it obvious it's your own Page
3. Posting a comment on that broadcast from the Tester account
4. Back to the overlay: the same comment arriving WITH name and profile
   picture. This is the shot being assessed — hold it for 4-5 seconds
5. Responding on stream to that person by name
6. Optionally, the overlay showing Facebook alongside another platform

### Recording

QuickTime Player → File → New Screen Recording. Record the whole screen
rather than a region, so it's visibly a real desktop. Export as .mp4 or
.mov, keep it under about 100 MB.

### Narration — say this aloud, or add captions

===================== COPY FROM HERE =====================

This is GivesAChat, a chat overlay for my own live streams. I broadcast to Facebook and several other platforms at once, and this panel merges all of their chat into one place so I can respond to people while I'm live.

This is my Facebook Page, Gives A Minute, broadcasting now.

I'm posting a comment on that broadcast as a viewer.

Here it is arriving in the overlay, with the commenter's name and profile picture, which is what pages_read_user_content and pages_read_engagement provide. That's what lets me answer them by name on stream.

And here it is alongside comments from the other platforms I stream to. Nothing is stored — messages appear for a few seconds and are discarded.

====================== TO HERE ======================


## 5. The apparent catch-22, and why it isn't one

Standard Access is not "no access". It returns the full commenter name
and profile picture for anyone holding a role on your app — which is
precisely why it exists: so you can build and demonstrate before review.

So you can record this working today. Add a second Facebook account of
your own as a Tester and comment from it. That is the identical code
path everyone gets after approval, so the recording is accurate rather
than staged.

Do not mock the UI or edit a name in. A reviewer who suspects the
demonstration is fabricated is a rejection you cannot appeal your way
out of.


## 6. Before submitting — checklist

- [ ] Only pages_read_user_content and pages_read_engagement in the request
- [ ] API test calls show Completed for both
- [ ] Privacy policy URL loads
- [ ] Screencast shows the overlay, the Page, the comment, and the name
      and picture rendering
- [ ] Descriptions pasted as plain text, no stray formatting


## 7. If it comes back rejected

Rejections are usually one of:

- the screencast doesn't show the permission's data actually rendering
- the description describes the app but not the specific permission
- the reviewer couldn't reproduce it

All three are fixable and resubmittable. A rejection is not a strike
against the app.
