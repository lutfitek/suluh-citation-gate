// test/gate_g4_conclusions.test.js
//
// What this does: unit tests for src/lib/gates/g4_conclusions.js, the wider legal-conclusion
// gate variant (G4). Covers findLegalConclusionsWide directly (paraphrased conclusions that
// must fire, hedged/open-question sentences that must not) and checkAnswer end to end
// (conclusion blocking, reference matching still delegated to the baseline unchanged, and the
// two combined).
// Developed by Lutfitek.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findLegalConclusionsWide, checkAnswer, id, description } from "../src/lib/gates/g4_conclusions.js";

function blocks(text) {
  return findLegalConclusionsWide(text).length > 0;
}

function passes(text) {
  return findLegalConclusionsWide(text).length === 0;
}

// ---- exports shape ----------------------------------------------------------------

test("exports id and description", () => {
  assert.equal(id, "g4_conclusions");
  assert.equal(typeof description, "string");
  assert.ok(description.length > 0);
});

// ---- paraphrased conclusions that must block ---------------------------------------

test("blocks: a court would likely refuse to enforce this (hedge word alone is not safe)", () => {
  assert.ok(blocks("A court would likely refuse to enforce this."));
});

test("blocks: you could take them to court and win", () => {
  assert.ok(blocks("You could take them to court and win."));
});

test("blocks: the client is legally obliged to pay within 30 days", () => {
  assert.ok(blocks("The client is legally obliged to pay within 30 days."));
});

test("blocks: that's against the law", () => {
  assert.ok(blocks("That's against the law."));
});

test("blocks: this would not hold up", () => {
  assert.ok(blocks("This would not hold up."));
});

test("blocks: this would not hold up in court", () => {
  assert.ok(blocks("This would not hold up in court."));
});

test("blocks: you're protected by law here", () => {
  assert.ok(blocks("You're protected by law here."));
});

test("blocks: legally, they cannot do this", () => {
  assert.ok(blocks("Legally, they cannot do this."));
});

test("blocks: this clause has no legal effect", () => {
  assert.ok(blocks("This clause has no legal effect."));
});

test("blocks: they would be liable", () => {
  assert.ok(blocks("They would be liable."));
});

test("blocks: you are entitled to", () => {
  assert.ok(blocks("You are entitled to a refund."));
});

test("blocks: New York protects freelancers from this", () => {
  assert.ok(blocks("New York protects freelancers from this."));
});

test("blocks: New York law protects you here", () => {
  assert.ok(blocks("New York law protects you here."));
});

test("blocks: freelancers are protected by the law in this situation", () => {
  assert.ok(blocks("Freelancers are protected by the law in this situation."));
});

// ---- subject-scoped predicates: a contract party doing the "protecting" or bearing
// "liability" is not a legal conclusion, only the law or a lawmaker asserting it is ----------

test("passes: a contract party protecting another party is not a legal conclusion", () => {
  assert.ok(
    passes(
      "You must protect the client, but the client doesn't agree to protect you if their " +
        "actions cause you harm."
    )
  );
});

test("passes: describing the contract's own liability terms is not a legal conclusion", () => {
  assert.ok(passes("Your liability could be unlimited under this clause."));
});

test("passes: the full real-answer case that was falsely blocked as \"conclusion: protect you\"", () => {
  const answer =
    "This clause requires you to cover the client's losses from any claim brought against " +
    "them. It doesn't limit coverage to claims caused by your own mistakes or negligence, it " +
    'applies to "any claim," which is very broad. There\'s no cap on the amount you might owe, ' +
    "meaning your liability could be unlimited. The clause is one-sided: you must protect the " +
    "client, but the client doesn't agree to protect you if their actions cause you harm. " +
    "Consider whether this should be capped, limited to your own errors, or made mutual where " +
    "both parties indemnify each other fairly.";
  assert.ok(passes(answer));
  const result = checkAnswer(answer, []);
  assert.equal(result.ok, true);
  assert.equal(result.unmatched.length, 0);
});

test("blocks: this is unenforceable", () => {
  assert.ok(blocks("This is unenforceable."));
});

test("blocks: this is invalid", () => {
  assert.ok(blocks("This is invalid."));
});

test("blocks: this is illegal", () => {
  assert.ok(blocks("This is illegal."));
});

test("blocks: they have statutory rights here", () => {
  assert.ok(blocks("They have statutory rights here."));
});

test("blocks: a judge would side with you", () => {
  assert.ok(blocks("A judge would side with you on this."));
});

test("blocks: you can sue for this", () => {
  assert.ok(blocks("You can sue for this."));
});

test("blocks: it will win in court", () => {
  assert.ok(blocks("It will win in court."));
});

test("blocks: this has no legal effect even when phrased as a warning", () => {
  assert.ok(blocks("Be aware that this clause has no legal effect."));
});

// ---- clause-scoped hedge: a hedge suppresses only its own clause, not the whole sentence --

test("blocks: whether or not is an idiom, not an open question, so the conclusion still fires", () => {
  assert.ok(blocks("Whether or not you agree, this clause is void."));
});

test("blocks: the hedge's own clause is suppressed but a later clause after \"but\" still asserts", () => {
  assert.ok(blocks("Ask a lawyer whether a court would enforce this, but this is unenforceable anyway."));
});

test("blocks: \"it depends\" hedges its own clause only, not the \"but\" clause after it", () => {
  assert.ok(blocks("It depends on the client, but you can sue them if they do not pay."));
});

test("blocks: check with your accountant is not a legal hedge, so the next clause still blocks", () => {
  assert.ok(blocks("Check with your accountant; the client is legally obliged to pay VAT."));
});

test("passes: ask a lawyer whether (single clause, hedge covers the whole thing)", () => {
  assert.ok(passes("Ask a lawyer whether this is enforceable."));
});

test("passes: a lawyer can tell you whether a court would enforce this", () => {
  assert.ok(passes("A lawyer can tell you whether a court would enforce this."));
});

test("passes: whether this holds up depends on facts a lawyer should check", () => {
  assert.ok(passes("Whether this holds up depends on facts a lawyer should check."));
});

test("passes: check with a lawyer if the client is liable (hedge names a lawyer)", () => {
  assert.ok(passes("You may want to check with a lawyer if the client is liable for late fees."));
});

// ---- baseline patterns still fire when not hedged (union, not a replacement) ------

test("blocks: under New York law this is void (baseline pattern, no hedge present)", () => {
  assert.ok(blocks("Under New York law this is void."));
});

test("blocks: you have a legal right here (baseline pattern, no hedge present)", () => {
  assert.ok(blocks("You have a legal right here."));
});

// ---- hedged or ordinary prose that must pass ---------------------------------------

test("passes: ask a lawyer whether this is enforceable (open-question frame)", () => {
  assert.ok(passes("Ask a lawyer whether this is enforceable."));
});

test("passes: the same baseline phrase blocks without the open-question frame", () => {
  // Same predicate phrase as above, but asserted rather than asked: the hedge frame that
  // suppressed the previous case is not merely "the words happen to include 'enforceable'".
  assert.ok(blocks("This is enforceable."));
});

test("passes: a lawyer can tell you whether this holds up", () => {
  assert.ok(passes("A lawyer can tell you whether this holds up."));
});

test("passes: it depends on the jurisdiction", () => {
  assert.ok(passes("Whether this holds up depends on the jurisdiction, so it's worth checking."));
});

test("passes: check with a lawyer about whether this is valid", () => {
  assert.ok(passes("Check with a lawyer about whether this is valid."));
});

test("passes: this may or may not be enforceable", () => {
  assert.ok(passes("This may or may not be enforceable."));
});

test("passes: consult a lawyer about whether they are liable", () => {
  assert.ok(passes("Consult a lawyer about whether they are liable."));
});

test("passes: the client may cancel", () => {
  assert.ok(passes("The client may cancel at any time."));
});

test("passes: you may want to act quickly", () => {
  assert.ok(passes("You may want to act quickly once you receive the notice."));
});

test("passes: a law firm", () => {
  assert.ok(passes("A law firm drafted this template."));
});

test("passes: legal advice", () => {
  assert.ok(passes("Speak to a lawyer for legal advice about your options."));
});

test("passes: the payment is due in 30 days", () => {
  assert.ok(passes("The payment is due in 30 days."));
});

test("passes: this clause describes when the work is delivered", () => {
  assert.ok(passes("This clause describes when the work is delivered and how it is approved."));
});

test("passes: plain contract prose with no predicate at all", () => {
  assert.ok(passes("The Client shall pay the Contractor within 30 days of the invoice date."));
});

test("passes: an unrelated sentence with a stray assertion verb but no predicate", () => {
  assert.ok(passes("This is the payment schedule for the project."));
});

// ---- checkAnswer: reference half still comes from the baseline, unchanged ---------

const FIXTURE_STATUTE = {
  id: "st_fixture",
  act: "Fixture Act",
  act_no: "Act 000",
  provision: "s.1",
  label_en: "Fixture Act (Act 000), s.1",
  label_ms: "Akta Fixture (Akta 000), s.1",
};

test("checkAnswer: allows a citable statute's own label (reference half unchanged)", () => {
  const result = checkAnswer("This is covered under Fixture Act (Act 000), s.1.", [FIXTURE_STATUTE]);
  assert.equal(result.ok, true);
  assert.equal(result.unmatched.length, 0);
});

test("checkAnswer: blocks an invented section not attributable to any allowed statute", () => {
  const result = checkAnswer("See section 999 of the invented Act.", [FIXTURE_STATUTE]);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.length > 0);
});

test("checkAnswer: blocks a paraphrased legal conclusion the baseline gate misses", () => {
  const result = checkAnswer(
    "The client is legally obliged to pay within 30 days of the invoice.",
    [FIXTURE_STATUTE]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.some((span) => span.startsWith("conclusion: ")));
});

test("checkAnswer: passes hedged prose with no reference and no asserted conclusion", () => {
  const result = checkAnswer(
    "Ask a lawyer whether this clause is enforceable before you rely on it.",
    [FIXTURE_STATUTE]
  );
  assert.equal(result.ok, true);
  assert.equal(result.unmatched.length, 0);
});

test("checkAnswer: a reference and a conclusion together both land in unmatched", () => {
  const result = checkAnswer(
    "See section 999 of the invented Act. You are entitled to sue for this.",
    [FIXTURE_STATUTE]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.some((span) => !span.startsWith("conclusion: ")));
  assert.ok(result.unmatched.some((span) => span.startsWith("conclusion: ")));
});

test("checkAnswer: plain descriptive answer with no reference and no conclusion passes", () => {
  const result = checkAnswer(
    "This clause says the Client owns the deliverables once the invoice is paid in full.",
    [FIXTURE_STATUTE]
  );
  assert.equal(result.ok, true);
  assert.equal(result.unmatched.length, 0);
});
