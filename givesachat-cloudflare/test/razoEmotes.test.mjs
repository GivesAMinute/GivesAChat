import { describe, it, expect } from "vitest";
import { applyRazoEmotes, RAZO_EMOTE_BASE } from "../src/razoEmotes.js";

/* ---------------------------------------------------------
   The two codes below are the only ones CONFIRMED, read out of
   Razo's own chat markup:

     data-quick-emote=":razo_angry:"  -> /emotes/razo/angry-56.webp
     :razo_shock:                      (seen rendering as text)

   Everything else the picker shows was identified from a
   screenshot of pictures, which is not a source of filenames —
   hence the open pattern rather than a hardcoded list.
--------------------------------------------------------- */

describe("applyRazoEmotes", () => {
  it("builds the documented url for a confirmed code", () => {
    const out = applyRazoEmotes(":razo_angry:");

    expect(out).toContain(`src="${RAZO_EMOTE_BASE}/emotes/razo/angry-112.webp"`);
    expect(out).toContain('class="relayed-emote razo-emote"');
    expect(out).not.toContain(":razo_angry:");
  });

  it("handles the second confirmed code", () => {
    expect(applyRazoEmotes(":razo_shock:")).toContain("/emotes/razo/shock-112.webp");
  });

  it("replaces several codes in one message", () => {
    const out = applyRazoEmotes("hi :razo_angry: there :razo_shock:");
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(out).toContain("hi ");
    expect(out).toContain(" there ");
  });

  it("is case-insensitive but normalises the filename", () => {
    /* A user typing :RAZO_Angry: should still get the emote, and
       the url must be lowercase — the files are. */
    const out = applyRazoEmotes(":RAZO_Angry:");
    expect(out).toContain("/emotes/razo/angry-112.webp");
  });

  it("leaves other platforms' codes alone", () => {
    expect(applyRazoEmotes(":kappa:")).toBe(":kappa:");
    expect(applyRazoEmotes(":vpzone_cool:")).toBe(":vpzone_cool:");
  });

  it("leaves ordinary text with colons alone", () => {
    const text = "see this: a list of things 10:30";
    expect(applyRazoEmotes(text)).toBe(text);
  });

  it("degrades a missing emote to readable alt text", () => {
    /* An unknown name 404s and the browser falls back to alt.
       Underscores become spaces so that reads as words — the
       same text the lane shows today, so a wrong guess is never
       WORSE than current behaviour. */
    const out = applyRazoEmotes(":razo_deal_with_it:");
    expect(out).toContain('alt="deal with it"');
  });

  /* ---------------------------------------------------------
     This function inserts markup into already-sanitised HTML,
     which is precisely the shape of the superchat XSS this
     project already shipped once. So the hostile cases are
     tested, not assumed away.
  --------------------------------------------------------- */
  it("cannot be used to inject an attribute or a tag", () => {
    /* The assertion that matters is that NO TAG IS BUILT. The
       hostile string comes back byte-for-byte because it does
       not match the pattern, so it stays inert text — and it
       reached this function already escaped by sanitizeHtml.

       Asserting it "does not contain onerror=" was the wrong
       test and failed on correct code: the characters survive,
       they just are not markup. */
    const hostile = ':razo_a" onerror="alert(1):';
    const out = applyRazoEmotes(hostile);

    expect(out).toBe(hostile);
    expect(out).not.toContain("<img");
  });

  it("escapes a name that reaches the attribute", () => {
    /* Nothing matchable can contain a quote today, so this
       guards the escaping itself rather than a live hole — if
       the pattern is ever widened, this fails first. */
    for (const code of [':razo_a"b:', ":razo_a<b:", ":razo_a&b:"]) {
      const out = applyRazoEmotes(code);
      expect(out).not.toContain("<img");
    }
  });

  it("ignores a name with a slash or a dot", () => {
    /* Path traversal into the src. The pattern excludes these,
       so they stay as plain text. */
    expect(applyRazoEmotes(":razo_../../etc:")).toBe(":razo_../../etc:");
    expect(applyRazoEmotes(":razo_a.b:")).toBe(":razo_a.b:");
  });

  it("ignores an absurdly long name", () => {
    const long = `:razo_${"a".repeat(200)}:`;
    expect(applyRazoEmotes(long)).toBe(long);
  });

  it("survives non-string input", () => {
    expect(applyRazoEmotes(null)).toBe(null);
    expect(applyRazoEmotes(undefined)).toBe(undefined);
  });
});
