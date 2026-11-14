// givesachat-cloudflare/src/veloraSocketTransform.js

import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { applyVeloraEmotes } from "./veloraEmotes.js";
import { resolveVeloraBadges, resolveSubscriptionBadge } from "./veloraBadges.js";

/* ---------------------------------------------------------
   Velora chat SOCKET -> our chat payload.

   Velora chat normally arrives on the chat.message WEBHOOK and
   is transformed by veloraTransform.js. That path works and is
   not touched by any of this.

   It has exactly one hole: the webhook does not deliver
   bot-authored messages. Confirmed on 14 Nov 2026 by logging the
   author of every chat.message POST while triggering a command —
   two human messages arrived by name and the bot's reply
   produced no POST at all:

     [VELORA CHAT] author="CompTech"      text="ok"
     [VELORA CHAT] author="GivesAMinute"  text="!mods"
     (nothing for CapWeinersCupGame)

   The Chat WebSocket does carry them. So this transform exists
   for the socket's `newMessage` frames, and the room that owns it
   forwards ONLY bot messages — see veloraChatRoom.js for why
   forwarding everything would double-render all human chat.

   ⚠️ THE TWO PAYLOAD SHAPES ARE NOT THE SAME.

   The webhook sends a flat-ish `data` with displayName, avatarUrl
   and badges at the top level. The socket documents `newMessage`
   as "id, sender, content, badges, channelRole, replyTo" — the
   author is nested under `sender` and the text is `content`, not
   `message`. Velora has five different naming conventions for a
   user across its payloads already, so every field below is read
   through a fallback chain rather than assumed, and the room logs
   the first frame verbatim so the real shape can be checked
   against this instead of trusted.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   ⭐ WHAT COUNTS AS A BOT.

   Documented: "User IDs starting with bot:, streamerbot: or
   devapp: carry isBot: true in their newMessage payloads."

   So isBot is the primary signal and the id prefix is the
   fallback, because a flag that is merely absent (the webhook
   sends no isBot at all) must not be read as false when the id
   says otherwise.

   This is load-bearing for duplicates, not just for rendering:
   anything this returns false for is DROPPED by the room,
   because the webhook is already delivering it.
--------------------------------------------------------- */
const BOT_ID_PREFIXES = ["bot:", "streamerbot:", "devapp:"];

export function isBotMessage(frame = {}) {
  const sender = frame.sender || frame.user || frame.author || {};

  if (sender.isBot === true || frame.isBot === true) return true;

  const id = String(
    sender.id ?? sender.userId ?? frame.senderId ?? frame.userId ?? ""
  ).toLowerCase();

  return BOT_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/* ---------------------------------------------------------
   Velora's own id for the message, used for dedupe both inside
   the room and in the overlay's dedupeKey(). Without one the
   overlay falls back to hashing author+text, and a bot that
   answers "!mods" with the same mod list every time would have
   its second and third reply of a stream silently collapsed.
--------------------------------------------------------- */
export function socketMessageId(frame = {}) {
  return frame.id ?? frame.messageId ?? frame._id ?? null;
}

export async function transformVeloraSocketMessage(frame, env) {
  if (!frame || typeof frame !== "object") return null;

  const sender = frame.sender || frame.user || frame.author || {};

  const rawMessage =
    frame.content ??
    frame.message ??
    frame.html ??
    frame.text ??
    "";

  if (!String(rawMessage).trim()) return null;

  /* Same two steps, in the same order, as the webhook path:
     emotes expanded first, then sanitised. Reversing them would
     strip the <img> tags the emote pass just inserted. */
  const htmlMessage = sanitizeHtml(
    await applyVeloraEmotes(String(rawMessage), env)
  );

  const badges = Array.isArray(frame.badges)
    ? frame.badges
    : Array.isArray(sender.badges)
      ? sender.badges
      : [];

  /* channelRole is the socket's way of saying moderator/vip/
     subscriber, where the webhook uses isModerator/isVip/isSub.
     A bot granted the mod role arrives as a moderator here, and
     the overlay already has artwork for that. */
  const role = String(frame.channelRole || sender.channelRole || "").toLowerCase();

  /* Badge resolution needs the same shape veloraBadges expects
     from the webhook (it reads data.badges and the sub fields),
     so it is handed a webhook-shaped object rather than the
     frame. */
  const badgeInput = {
    badges,
    subTier: frame.subTier ?? sender.subTier ?? null,
    subMonths: frame.subMonths ?? sender.subscriberMonths ?? 0
  };

  return {
    type: "chat",
    platform: "velora",

    messageId: socketMessageId(frame),

    username:
      sender.displayName ||
      sender.username ||
      frame.displayName ||
      frame.username ||
      null,

    avatar:
      sender.avatarUrl ||
      sender.avatar ||
      frame.avatarUrl ||
      null,

    badges,
    subscriptionBadge: await resolveSubscriptionBadge(badgeInput, env),
    catalogBadges: await resolveVeloraBadges(badges, env),

    html: htmlMessage,

    /* ⭐ A bot IS flagged, and the overlay should be able to say
       so. Passed through rather than acted on here — the chat
       lane decides whether to draw a bot badge, and the TTS
       decides whether to read it aloud. */
    isBot: isBotMessage(frame),

    isModerator: role === "moderator" || frame.isModerator === true,
    isMod: role === "moderator" || frame.isModerator === true,
    isVip: role === "vip" || frame.isVip === true,
    isSubscriber:
      role === "subscriber" ||
      frame.isSubscriber === true ||
      frame.isSub === true,

    subTier: frame.subTier ?? sender.subTier ?? null,
    subscriberMonths: frame.subMonths ?? sender.subscriberMonths ?? 0,

    color: frame.color || sender.color || null,

    effect: frame.effect || frame.messageEffects?.effect || null,
    effectColor: frame.effectColor || frame.messageEffects?.color || null,

    /* The socket carries reply context the webhook does not.
       Kept as plain strings; the overlay escapes on render. */
    replyTo: frame.replyTo
      ? {
          messageId: frame.replyTo.messageId ?? null,
          username: frame.replyTo.username ?? null,
          snippet: frame.replyTo.snippet ?? null
        }
      : null,

    /* Marks the delivery path, so a duplicate in the lane can be
       traced to a source without guesswork. This is exactly how
       the Blaze duplicate was finally identified after four wrong
       diagnoses — via="beam" on the payload settled it. */
    via: "velora-socket"
  };
}
