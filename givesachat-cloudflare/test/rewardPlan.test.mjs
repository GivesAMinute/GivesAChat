import { buildRewardPlan, trigger } from "../src/rewardPlan.js";

const R = (name, description = "") => ({ id: name, name, description });
let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const list = [
  R("What A Beautiful Group Of People", 'Plays Trump saying "What A Beautiful Group Of People"'),
  R("I'm Not Like Some Madman", 'Plays Marty saying "I\'m not like some madman"'),
  R("I'm Not Like Some Madman (Full)", "Plays Marty saying (in full): I'm Not Like Some Madman"),
  R("Grab Your Baby", 'Plays Trump saying "Grab Your Baby"'),
  R("Grab Your Baby (Full)", 'Plays Trump saying (in full) "Grab Your Baby"'),
  R("Hello There!", 'Plays Tooth Boy saying "Hello There!"'),
  R("Purrrrrrrrrrrfect", 'Plays me saying "Purrrrrrrrrrrfect!"'),
  R("This Is Reality", 'Plays Tim Pool saying "This Is Reality"'),
  R("This Is Reality (Russell Brand)", "Plays Russell Brand telling us this is reality"),
  R("Demon", "Plays Tooth Boy's inner Demon coming out"),
  R("It's Going, It's Hovering... It's Gone!", "Plays the Aussie backyard rocket launch fail!")
];

const { rows, clashes } = buildRewardPlan(list);
const by = Object.fromEntries(rows.map((r) => [r.name, r]));

is("no clashes", clashes.length, 0);
is("long name shortens", by["What A Beautiful Group Of People"].finalTrigger, "beautiful");
is("base owns the plain word", by["I'm Not Like Some Madman"].finalTrigger, "madman");
is("variant takes the suffix", by["I'm Not Like Some Madman (Full)"].finalTrigger, "madmanfull");
is("short base overridden too", by["Grab Your Baby"].finalTrigger, "baby");
is("its variant follows", by["Grab Your Baby (Full)"].finalTrigger, "babyfull");
is("punctuation stripped", by["Hello There!"].finalName, "Hello There");
is("depunctuate is not a rename", by["Hello There!"].action, "depunctuate");
is("override beats the scorer", by["Purrrrrrrrrrrfect"].finalTrigger, "purrfect");
is("already fine is untouched", by["Demon"].changed, false);
is("no punctuation anywhere", rows.every((r) => /^[a-z0-9]*$/.test(r.finalTrigger)), true);

// the two near-identical names must not converge
is("Reality pair differ",
   by["This Is Reality"].finalTrigger !== by["This Is Reality (Russell Brand)"].finalTrigger, true);

// phrase preservation
is("phrase kept when description lacks it",
   by["It's Going, It's Hovering... It's Gone!"].finalDescription?.includes("It's Going") ?? false, true);
is("no description churn when phrase is safe",
   by["What A Beautiful Group Of People"].finalDescription, null);

// determinism: same input, same output
const again = buildRewardPlan(list);
is("deterministic", JSON.stringify(again.rows.map(r=>r.finalName)), JSON.stringify(rows.map(r=>r.finalName)));

// a genuine collision must be REPORTED, not silently resolved
const dup = buildRewardPlan([R("Applause"), R("Applause!")]);
is("real collision is caught", dup.clashes.length, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
