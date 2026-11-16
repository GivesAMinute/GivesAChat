import { describe, it, expect, vi } from "vitest";

vi.mock("../src/veloraEmotes.js", () => ({
  applyVeloraEmotes: async (t) => t
}));
vi.mock("../src/veloraBadges.js", () => ({
  resolveVeloraBadges: async () => [],
  resolveSubscriptionBadge: async () => null
}));

const { transformVeloraEvent } = await import("../src/veloraTransform.js");
const { identifyClaim } = await import(
  "../../public/overlay/popups/modules/claimAlerts.js"
);

const env = {};

/* ---------------------------------------------------------
   The 1st-GIVER claim, verbatim from a live tail on
   14 Nov 2026. Note reward.name is null — which is exactly why
   a title match was never going to carry this.
--------------------------------------------------------- */
const REAL_CLAIM = {
  event: "channel.channel_points_redemption",
  data: {
    user: { displayName: "CompTech", username: "CompTech" },
    reward: {
      id: "58dd6d31-8df9-43a5-8f45-7015be44eaa2",
      name: null,
      cost: 1,
      cardDesign: {
        textLine1: { content: "{username} was the 1st GIVER to this stream!" },
        textLine2: { content: "This is their {times} time claiming {place}!" }
      }
    },
    redemptionId: "fc62c0eb-8c10-42a6-ae52-d943c1209d7c",
    status: "fulfilled"
  }
};

/* The reward that misfired: an ordinary soundboard clip whose
   NAME contains "Second". */
const SOUNDBOARD = {
  event: "channel.channel_points_redemption",
  data: {
    user: { displayName: "net-TV", username: "net-TV" },
    reward: {
      id: "aaaaaaaa-1111-2222-3333-444444444444",
      name: "I Loved The Second One Too",
      cost: 1,
      cardDesign: {
        textLine1: { content: "net-TV:" },
        textLine2: { content: "I Loved The Second One" }
      }
    },
    redemptionId: "r-1",
    status: "fulfilled"
  }
};

describe("claim detection in the worker", () => {
  it("still recognises the real 1st claim by id", async () => {
    const out = await transformVeloraEvent(REAL_CLAIM.event, REAL_CLAIM, env);
    expect(out?.data?.alertType).toBe("claim");
    expect(out?.data?.place).toBe("1st");
  });

  /* ⭐ THE BUG. */
  it("does NOT treat a soundboard clip named '…Second…' as a claim", async () => {
    const out = await transformVeloraEvent(SOUNDBOARD.event, SOUNDBOARD, env);
    expect(out?.data?.alertType).not.toBe("claim");
  });

  it("recognises a recreated claim by its card template alone", async () => {
    /* The case the title fallback existed for: new id, no name. */
    const recreated = structuredClone(REAL_CLAIM);
    recreated.data.reward.id = "99999999-0000-0000-0000-000000000000";

    const out = await transformVeloraEvent(recreated.event, recreated, env);
    expect(out?.data?.place).toBe("1st");
  });

  it("reads 2nd from a 2nd-place card template", async () => {
    const second = structuredClone(REAL_CLAIM);
    second.data.reward.id = "99999999-0000-0000-0000-000000000001";
    second.data.reward.cardDesign.textLine1.content =
      "{username} was the 2nd GIVER to this stream!";

    const out = await transformVeloraEvent(second.event, second, env);
    expect(out?.data?.place).toBe("2nd");
  });
});

describe("claim detection in the popups overlay", () => {
  it("recognises the real claims by id", () => {
    expect(identifyClaim({ rewardId: "58dd6d31-8df9-43a5-8f45-7015be44eaa2" }))
      .toEqual({ place: "1st", effect: "confetti" });

    expect(identifyClaim({ rewardId: "f49bd3f1-ae87-4359-b15b-7c28857d036f" }))
      .toEqual({ place: "2nd", effect: "balloons" });
  });

  /* ⭐ THE BUG, on the surface that actually drew the balloons. */
  it("does NOT fire balloons for a title containing 'Second'", () => {
    expect(identifyClaim({
      rewardId: "aaaaaaaa-1111-2222-3333-444444444444",
      rewardTitle: "I Loved The Second One Too"
    })).toBe(null);
  });

  it("does NOT fire confetti for a title containing 'First'", () => {
    expect(identifyClaim({
      rewardId: "bbbb",
      rewardTitle: "The First Time I Heard This"
    })).toBe(null);
  });

  it("accepts the auto-appended place suffix", () => {
    expect(identifyClaim({ rewardId: "new-id", rewardTitle: "Second (2nd)" }))
      .toEqual({ place: "2nd", effect: "balloons" });
  });

  it("accepts a claim card template with a new id", () => {
    expect(identifyClaim({
      rewardId: "new-id",
      cardDesign: {
        textLine1: { content: "{username} was the 1st GIVER to this stream!" },
        textLine2: { content: "This is their {times} time claiming {place}!" }
      }
    })).toEqual({ place: "1st", effect: "confetti" });
  });

  it("ignores a non-claim card that happens to say 2nd", () => {
    /* No {place}/{times} placeholders, so not a claim card. */
    expect(identifyClaim({
      rewardId: "x",
      cardDesign: { textLine1: { content: "I came 2nd in the race" } }
    })).toBe(null);
  });
});
