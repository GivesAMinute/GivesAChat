import { sanitizeHtml } from "./sanitizeNodeHTML.js";
import { applyVeloraEmotes } from "./veloraEmotes.js";
import { resolveVeloraBadges, resolveSubscriptionBadge } from "./veloraBadges.js";

/* ---------------------------------------------------------
   1st / 2nd GIVER claim rewards.

   Kept in sync with CLAIM_REWARDS in
   public/overlay/popups/modules/claimAlerts.js — if the
   rewards are ever recreated in Velora their IDs change, and
   both lists need the new values. The title match is the
   safety net for exactly that case.
--------------------------------------------------------- */
const CLAIM_REWARD_IDS = [
  "58dd6d31-8df9-43a5-8f45-7015be44eaa2",   // First (1st)
  "f49bd3f1-ae87-4359-b15b-7c28857d036f"    // Second (2nd)
];

/* ---------------------------------------------------------
   ⭐ READS BOTH PAYLOAD SHAPES, BECAUSE VELORA SENDS BOTH.

   channel.channel_points_redemption carries rewardId and
   rewardTitle. pointsCelebration carries itemId and itemName for
   the same redemption.

   This used to check only the first pair, so a claim arriving as
   a pointsCelebration sailed past and rendered in the chat lane —
   as a bare "Reward" card with no title, since rewardName was
   reading data.itemName through the other branch's field names.

   The popups overlay had excluded claims correctly all along,
   which is what made this hard to see: the card came from the
   worker, not from the overlay everyone was looking at.
--------------------------------------------------------- */
function isClaimReward(data = {}) {
  /* ---------------------------------------------------------
     ⭐ THE REAL PAYLOAD IS NESTED. Captured from a live raid and
     a live claim, not from a test alert:

       data.reward.id    "f49bd3f1-…"   <- Second (2nd)
       data.reward.name  null            <- always null here
       data.user.displayName

     Every previous version of this checked data.rewardId, then
     data.itemId, then their title equivalents. None of those
     exist on the wire, so a claim was NEVER excluded and landed
     in the chat lane as a bare "Reward" card every single time.

     Three guesses came from Velora's TEST alert, which carries a
     completely different, flat shape. The test was never a
     smaller version of the real thing.

     The flat names are kept as fallbacks: the Socket.IO feed the
     popups overlay listens to does use them, and this function is
     the shared answer to "is this a claim".
  --------------------------------------------------------- */
  const id = data.reward?.id || data.rewardId || data.itemId;
  if (CLAIM_REWARD_IDS.includes(id)) return true;

  const title = String(
    data.reward?.name || data.rewardTitle || data.itemName || ""
  );
  return /\b(first|1st|second|2nd)\b/i.test(title);
}

/* ---------------------------------------------------------
   Which place was claimed — "1st" or "2nd", or null.

   Id first, title second, for the same reason isClaimReward
   checks both: ids are exact but change if a reward is ever
   recreated in Velora, and the title is the safety net.
--------------------------------------------------------- */
function claimPlace(data = {}) {
  const id = data.reward?.id || data.rewardId || data.itemId;

  if (id === CLAIM_REWARD_IDS[0]) return "1st";
  if (id === CLAIM_REWARD_IDS[1]) return "2nd";

  const title = String(
    data.reward?.name || data.rewardTitle || data.itemName || ""
  );

  if (/\b(first|1st)\b/i.test(title)) return "1st";
  if (/\b(second|2nd)\b/i.test(title)) return "2nd";

  return null;
}

/* ---------------------------------------------------------
   ⭐ A claim, as a card for the CHAT LANE.

   The popups overlay owns the celebration — card, sound,
   confetti, balloons — and none of that changes. But the popups
   overlay is not always open: during an IRL stream the chat lane
   is the only thing on screen, and a claim happening there was
   completely invisible.

   So the lane gets the card too, and only the card. Deliberately
   NOT included: customSoundUrl, and anything that would start an
   effect. Sound stays with the popups so a claim cannot play
   twice when both overlays are open.

   Built as a velora_system alert rather than a reward card
   because that is already the lane's format for "something
   happened on the stream" — follows, subs, raids and Volts all
   render through it, and the popups' own claim card was
   explicitly modelled on it (see claimAlerts.js). Matching it
   means no new card design and no new stylesheet.

   Both event branches below call this. Velora emits a
   redemption AND a pointsCelebration for a single claim, so
   emitting from one branch alone would miss claims that arrive
   through the other. ChatRoom.isDuplicateAlert() collapses the
   pair on an 8-second type|name key — the same mechanism that
   already de-duplicates raids.
--------------------------------------------------------- */
function claimLaneCard(data = {}) {
  const place = claimPlace(data);

  const displayName =
    data.user?.displayName || data.user?.username ||
    data.displayName || data.username || null;

  /* No name means the card would read "Someone was 1st to the
     stream!", which tells the streamer nothing they can act on.
     ChatRoom drops nameless alerts anyway; returning null here
     says so at the point the decision belongs. */
  if (!displayName) return null;

  const where = place ? `${place} to the stream` : "a claim";

  return {
    type: "velora_system",
    event: "channel.stream_alert",
    platform: "velora",
    data: {
      alertType: "claim",
      place,
      displayName,
      username: data.user?.username || data.username || null,
      avatarUrl: data.user?.avatarUrl || data.avatarUrl || null,

      /* The sentence is built here rather than left to the
         overlay: reward.name arrives null on every redemption
         observed, so the lane cannot derive it from the payload
         the way the popups can from Velora's socket. */
      message: `${displayName} was ${where}!`,

      // The popups play the sound. The lane must not.
      customSoundUrl: null
    }
  };
}

/**
 * Velora WebSocket Chat Transformer
 */
export async function transformVeloraChatMessage(msg, env) {
  try {
    if (!msg) return null;

    const rawMessage =
      msg.message ||
      msg.html ||
      msg.text ||
      "";

    const htmlMessage = sanitizeHtml(
      await applyVeloraEmotes(rawMessage, env)
    );

    const effect =
      msg.messageEffects?.effect ||
      msg.messageEffects?.name ||
      msg.effect ||
      null;

    const effectColor =
      msg.messageEffects?.color ||
      msg.effectColor ||
      null;

    return {
      type: "chat",
      platform: "velora",

      messageId: msg.messageId || msg.id || null,
      username: msg.username || msg.displayName || "Unknown",
      avatar: msg.avatar || msg.avatarUrl || null,

      badges: Array.isArray(msg.badges) ? msg.badges : [],

      /* Resolved here rather than in the overlay: the channel's
         badge set is one fetch, cached for an hour, and the
         browser should never have to look anything up to render
         a message. */
      subscriptionBadge: await resolveSubscriptionBadge(msg, env),

      // Catalog badges (events etc.) resolved to asset urls. Role
      // badges are excluded — the overlay has its own artwork.
      catalogBadges: await resolveVeloraBadges(msg.badges, env),

      html: htmlMessage,

      isModerator: msg.isModerator || msg.isMod || false,
      isMod: msg.isModerator || msg.isMod || false,
      isVip: msg.isVip || false,

      /* isSub is what the docs actually document; isSubscriber
         was the only field read before, so this was always
         false. Both are accepted. */
      isSubscriber: msg.isSub || msg.isSubscriber || false,
      subTier: msg.subTier ?? null,
      subscriberMonths: msg.subMonths || msg.subscriberMonths || 0,

      color: msg.color || msg.accentColor || null,

      effect,
      effectColor
    };
  } catch (err) {
    console.error("[VELORA] transformVeloraChatMessage error:", err);
    return null;
  }
}

/**
 * Velora Webhook Event Transformer
 */
export async function transformVeloraEvent(event, payload, env) {
  try {
    if (!payload || !payload.data) return null;

    const data = payload.data;
    const user = data.user || {};

    // ⭐ CHAT
    if (event === "chat.message") {
      const rawMessage =
        data.message ||
        data.html ||
        data.text ||
        "";

      const htmlMessage = sanitizeHtml(
        await applyVeloraEmotes(rawMessage, env)
      );

      const effect =
        data.messageEffects?.effect ||
        data.messageEffects?.name ||
        data.effect ||
        null;

      const effectColor =
        data.messageEffects?.color ||
        data.effectColor ||
        null;

      return {
        type: "chat",
        platform: "velora",
        messageId: data.messageId || data.id || null,
        username: data.displayName || data.username || null,
        avatar: data.avatarUrl || user.avatar || null,

        badges: Array.isArray(data.badges) ? data.badges : [],
        subscriptionBadge: await resolveSubscriptionBadge(data, env),

        // Catalog badges (events etc.) resolved to asset urls. Role
        // badges are excluded — the overlay has its own artwork.
        catalogBadges: await resolveVeloraBadges(data.badges, env),

        html: htmlMessage,

        isModerator: data.isModerator || data.isMod || user.roles?.mod || false,
        isMod: data.isModerator || data.isMod || user.roles?.mod || false,
        isVip: data.isVip || user.roles?.vip || false,
        isSubscriber:
          data.isSub || data.isSubscriber || user.roles?.subscriber || false,
        subTier: data.subTier ?? null,
        subscriberMonths:
          data.subMonths || data.subscriberMonths || user.subscriberMonths || 0,

        color: data.color || user.color || null,

        effect,
        effectColor
      };
    }

    // ⭐ REWARD: channel points
    if (event === "channel.channel_points_redemption") {
      /* -----------------------------------------------------
         1st / 2nd GIVER claims never render as a REWARD card.
         That was the bare "Reward" card with Velora's
         {username}/{times}/{place} placeholders unsubstituted.

         They now render as a stream-alert card instead, so the
         lane shows a claim when the popups overlay is closed —
         see claimLaneCard(). The popups are untouched.
      ----------------------------------------------------- */
      if (isClaimReward(data)) return claimLaneCard(data);

      /* Nested first, flat as fallback — see isClaimReward. Note
         reward.name arrives as null on every redemption observed,
         so this card frequently has no title through this path.
         The overlay's own relay carries the real name, and the
         chat lane refuses to render a nameless reward. */
      return {
        type: "reward",
        platform: "velora",
        redemptionId: data.redemptionId,
        rewardName: data.reward?.name || data.rewardTitle || null,
        rewardCost: data.reward?.cost ?? data.rewardCost ?? null,
        rewardId: data.reward?.id || data.rewardId || null,
        username:
          data.user?.displayName || data.user?.username ||
          data.displayName || data.username || null,
        avatar: data.user?.avatarUrl || data.avatarUrl || null,
        userInput: data.userMessage || data.userInput || null,
        redeemedAt: data.redeemedAt || null,
        rewardIcon: data.rewardIcon || null,
        rewardColor: data.rewardColor || null,
        cardDesign: data.reward?.cardDesign || data.cardDesign || null
      };
    }

    // ⭐ REWARD: points celebration
    if (event === "pointsCelebration") {
      /* Same treatment as the redemption branch above. Velora
         emits BOTH events for one redemption, so handling only
         one of them lets every claim through the other as a bare
         reward card. Emitting from both means a claim survives
         whichever event actually arrives; ChatRoom collapses the
         pair. */
      if (isClaimReward(data)) return claimLaneCard(data);

      const cd = data.cardDesign || {};
      const bg = cd.background || {};
      const iconCfg = cd.icon || {};

      const gradientColors =
        Array.isArray(bg.colors) && bg.colors.length
          ? bg.colors
          : [bg.color || "#ff0055", "#0066ff"];

      const rewardIcon =
        iconCfg.customIconUrl ||
        iconCfg.emoteUrl ||
        data.itemIconUrl ||
        null;

      return {
        type: "reward",
        platform: "velora",
        redemptionId: data.id,
        rewardName: data.itemName,
        rewardCost: data.cost,
        rewardId: data.itemId,
        username: data.displayName || data.username,
        avatar: data.avatarUrl || null,
        userInput: data.message || null,
        redeemedAt: data.createdAt || null,
        rewardIcon,
        rewardColor: gradientColors[0],
        cardDesign: data.cardDesign || null
      };
    }

    // ⭐ STREAM ALERTS — FIXED (restores stripped‑back chat card)
    const alertEvents = [
      "channel.follow",
      "channel.subscribe",
      "channel.subscription.gift",
      "channel.volts",
      "channel.raid",
      "channel.stream_alert"
    ];

    if (alertEvents.includes(event)) {
      return {
        type: "velora_system",
        event: "channel.stream_alert",
        platform: "velora",
        data: {
          alertType:
            data.alertType ||
            data.type ||
            event.replace("channel.", ""),

          /* ⭐ channel.raid puts the raider in data.raider and the
             count in data.viewerCount. Neither displayName nor
             viewers exists at the top level, which is why every
             raid rendered as "Someone raided!" — the name was
             never missing, we were reading the wrong place.

             ⭐ fromDisplayName / fromUsername added on Cory's word
             that raids are now flat:

               data.fromUsername, data.fromDisplayName,
               data.viewerCount

             That is a FIFTH naming convention for the same person
             across Velora's payloads, and the popups overlay has
             read it off the socket for a while — the worker never
             did. Had the webhook switched to it, every raid would
             have gone nameless here and been dropped by
             ChatRoom's nameless-alert rule, so the lane would show
             nothing at all rather than "Someone raided!".

             Added rather than swapped. data.raider is the shape
             captured from two real raids, so it keeps priority;
             this is a fallback beneath it. Both shapes work, and
             whichever Velora actually sends, the name resolves. */
          displayName:
            data.raider?.displayName || data.raider?.username ||
            data.user?.displayName || data.user?.username ||
            data.fromDisplayName || data.fromUsername ||
            data.displayName || data.username || null,
          username:
            data.raider?.username || data.raider?.displayName ||
            data.user?.username || data.user?.displayName ||
            data.fromUsername || data.fromDisplayName ||
            data.username || data.displayName || null,

          avatar: data.raider?.avatarUrl || data.user?.avatarUrl || null,

          count: data.count || data.amount || data.total || null,
          viewers: data.viewerCount ?? data.viewers ?? null,

          /* ---------------------------------------------------
             ⭐ Volts, under its own name.

             `count` above is a shared bucket for "how many" across
             follows, gifts and Volts, and the lane read the wrong
             one out of it — a real 120 rendered as 0. Carrying the
             amount as `volts` as well means the Volts card has a
             field that means only one thing, and cannot be lost to
             a naming collision with gift counts.

             `count` is left exactly as it was: the gift branch
             depends on it.

             templateData is included because stream_alert carries
             its numbers there while the typed events carry them
             flat, and a Volts send can arrive as either.
          --------------------------------------------------- */
          /* data.amount first, and no longer a guess: Cory
             confirmed channel.volts carries the amount flat as
             data.amount, alongside data.username, data.displayName
             and data.message. Nothing nested.

             He also found why the 120 showed as 0 — channel.volts
             was only firing for "quick celebration" sends and not
             for custom amounts, so no amount ever reached us. The
             card we DID see came from the stream_alert copy, which
             carries the name but not the number.

             The other names stay as fallbacks. They cost one ??
             each and this event has now changed shape twice. */
          volts:
            data.amount ??
            data.volts ??
            data.voltsAmount ??
            data.total ??
            data.templateData?.amount ??
            data.count ??
            null,

          message: data.message || null,
          customSoundUrl: data.customSoundUrl || null
        }
      };
    }

    return null;
  } catch (err) {
    console.error("[VELORA] transformVeloraEvent error:", err);
    return null;
  }
}

/**
 * ⭐ Beam Event Transformer (updated to feed overlay html)
 */
export function transformBeamEvent(raw) {
  const text = raw?.contents?.text || "";

  return {
    type: "chat",
    platform: "beam",

    username: raw?.sender?.name || "Unknown",
    avatar: raw?.sender?.avatar || null,

    html: text,

    sticker: raw?.sticker || raw?.contents?.sticker || null,

    raw
  };
}
