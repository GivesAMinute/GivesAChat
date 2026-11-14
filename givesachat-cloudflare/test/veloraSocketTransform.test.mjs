import { describe, it, expect, vi } from "vitest";

/* ---------------------------------------------------------
   The socket's newMessage shape is documented as a field LIST,
   not an example payload, and Velora already uses five different
   naming conventions for a user across its existing payloads. So
   the transform guesses with fallback chains, and these tests pin
   the guesses — including the ones that matter for DUPLICATES
   rather than for rendering.

   The bar here is set by what testing has caught in this project
   that reading never did: GivesAMinute -> GivesAminute, a
   superchat XSS through innerHTML, a GIF rendered at 34px. So the
   escaping and the bot classification are both tested on hostile
   input, not just happy-path input.
--------------------------------------------------------- */

vi.mock("../src/veloraEmotes.js", () => ({
  applyVeloraEmotes: async (text) => text
}));

vi.mock("../src/veloraBadges.js", () => ({
  resolveVeloraBadges: async () => [],
  resolveSubscriptionBadge: async () => null
}));

const {
  transformVeloraSocketMessage,
  isBotMessage,
  socketMessageId
} = await import("../src/veloraSocketTransform.js");

const env = {};

describe("isBotMessage", () => {
  it("accepts the documented isBot flag", () => {
    expect(isBotMessage({ sender: { isBot: true } })).toBe(true);
  });

  it("accepts each documented id prefix", () => {
    for (const id of [
      "bot:abc",
      "streamerbot:xyz",
      "devapp:123"
    ]) {
      expect(isBotMessage({ sender: { id } })).toBe(true);
    }
  });

  it("is case-insensitive on the id prefix", () => {
    /* The debug panel's own filter was written case-sensitive and
       silently discarded every line it existed to show. Same class
       of bug, so the same guard. */
    expect(isBotMessage({ sender: { id: "BOT:ABC" } })).toBe(true);
  });

  /* ⭐ THE DUPLICATE GUARD.

     Everything this returns false for is DROPPED by the room,
     because the webhook already delivered it. A false positive
     here double-renders a human message — the arena.social bug,
     which took three attempts to find. */
  it("rejects humans, including the absent-flag case", () => {
    expect(isBotMessage({ sender: { id: "2494fdcf-69b1", isBot: false } })).toBe(false);
    expect(isBotMessage({ sender: { id: "2494fdcf-69b1" } })).toBe(false);
    expect(isBotMessage({})).toBe(false);
  });

  it("does not treat a name merely containing 'bot' as a bot", () => {
    expect(isBotMessage({ sender: { id: "abc", username: "robotlover" } })).toBe(false);
    expect(isBotMessage({ sender: { id: "not-a-bot:1" } })).toBe(false);
  });
});

describe("socketMessageId", () => {
  it("prefers id and falls back", () => {
    expect(socketMessageId({ id: "a" })).toBe("a");
    expect(socketMessageId({ messageId: "b" })).toBe("b");
    expect(socketMessageId({})).toBe(null);
  });
});

describe("transformVeloraSocketMessage", () => {
  /* The documented shape: "id, sender, content, badges,
     channelRole, replyTo". Note content, not message, and the
     author nested under sender — both differ from the webhook. */
  const frame = {
    id: "msg-1",
    sender: {
      id: "bot:capweiners",
      username: "capweinerscupgame",
      displayName: "CapWeinersCupGame",
      avatarUrl: "https://assets.velora.tv/bot-avatars/x/a1b2.png",
      isBot: true
    },
    content: "Mods online: GivesAMinute, CompTech",
    badges: ["moderator"],
    channelRole: "moderator"
  };

  it("maps the documented shape to our chat payload", async () => {
    const out = await transformVeloraSocketMessage(frame, env);

    expect(out.type).toBe("chat");
    expect(out.platform).toBe("velora");
    expect(out.messageId).toBe("msg-1");
    expect(out.username).toBe("CapWeinersCupGame");
    expect(out.avatar).toBe("https://assets.velora.tv/bot-avatars/x/a1b2.png");
    expect(out.html).toContain("Mods online");
    expect(out.isBot).toBe(true);
    expect(out.isModerator).toBe(true);
    expect(out.via).toBe("velora-socket");
  });

  it("falls back to the webhook-style flat shape", async () => {
    /* If the socket turns out to send the webhook's naming after
       all, the transform must still work rather than render a
       message from "null". */
    const out = await transformVeloraSocketMessage(
      {
        id: "msg-2",
        displayName: "CapWeinersCupGame",
        message: "hello",
        isBot: true
      },
      env
    );

    expect(out.username).toBe("CapWeinersCupGame");
    expect(out.html).toContain("hello");
  });

  it("escapes markup in the message body", async () => {
    /* Streamlabs/superchat text arrived unsanitised into
       innerHTML once already. Bot output is third-party text
       going the same route. */
    const out = await transformVeloraSocketMessage(
      { ...frame, content: '<img src=x onerror="alert(1)">' },
      env
    );

    expect(out.html).not.toContain("onerror");
  });

  it("drops an empty or whitespace-only message", async () => {
    expect(await transformVeloraSocketMessage({ ...frame, content: "" }, env)).toBe(null);
    expect(await transformVeloraSocketMessage({ ...frame, content: "   " }, env)).toBe(null);
  });

  it("survives a frame that is not an object", async () => {
    expect(await transformVeloraSocketMessage(null, env)).toBe(null);
    expect(await transformVeloraSocketMessage("nope", env)).toBe(null);
  });

  it("carries reply context when present", async () => {
    const out = await transformVeloraSocketMessage(
      {
        ...frame,
        replyTo: { messageId: "p1", username: "GivesAMinute", snippet: "!mods" }
      },
      env
    );

    expect(out.replyTo.username).toBe("GivesAMinute");
  });

  it("maps channelRole to the overlay's role flags", async () => {
    const vip = await transformVeloraSocketMessage(
      { ...frame, channelRole: "vip" },
      env
    );
    expect(vip.isVip).toBe(true);
    expect(vip.isModerator).toBe(false);
  });
});
