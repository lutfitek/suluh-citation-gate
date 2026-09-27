// test/citations.test.js
//
// Unit tests for src/lib/citations.js: findLegalReferences catches every pattern named in
// docs/PHASES.md P2 (section/s./ss./seksyen, Act/Akta + number, "<Words> Act <year>",
// "Akta <Words> <year>", Order + number, Rules of Court, case-style "X v Y", Federal
// Constitution, Article + number); checkAnswer allows a citable statute's own label, blocks an
// invented section, and blocks a real-looking but uncitable statute (R2).
// Developed by Lutfitek.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findLegalReferences, checkAnswer } from "../src/lib/citations.js";

// ---- findLegalReferences: one sample per required pattern -----------------

test("findLegalReferences: section / s. / ss. / seksyen", () => {
  assert.ok(findLegalReferences("see s.26(2) for more").length > 0);
  assert.ok(findLegalReferences("under section 74 of the act").length > 0);
  assert.ok(findLegalReferences("rujuk seksyen 10").length > 0);
});

test("findLegalReferences: Act / Akta + number", () => {
  assert.ok(findLegalReferences("this is Act 332").some((s) => /act\s*332/i.test(s)));
  assert.ok(findLegalReferences("rujuk Akta 136").some((s) => /akta\s*136/i.test(s)));
});

test("findLegalReferences: <Words> Act <year> and Akta <Words> <year>", () => {
  assert.ok(
    findLegalReferences("under the Copyright Act 1987 you own it").some((s) =>
      /copyright act 1987/i.test(s)
    )
  );
  assert.ok(
    findLegalReferences("rujuk Akta Hak Cipta 1987").some((s) => /akta hak cipta 1987/i.test(s))
  );
});

test("findLegalReferences: Order + number and Rules of Court", () => {
  assert.ok(findLegalReferences("see Order 29 of the rules").some((s) => /order\s*29/i.test(s)));
  assert.ok(findLegalReferences("under the Rules of Court").some((s) => /rules of court/i.test(s)));
});

test("findLegalReferences: case-style X v Y, Federal Constitution, Article + number", () => {
  assert.ok(findLegalReferences("as decided in Ganesan v Sivam").length > 0);
  assert.ok(findLegalReferences("as held in Foo Bar v. Baz Quux").length > 0);
  assert.ok(
    findLegalReferences("this right comes from the Federal Constitution").some((s) =>
      /federal constitution/i.test(s)
    )
  );
  assert.ok(findLegalReferences("see Article 5 of it").some((s) => /article\s*5/i.test(s)));
});

test("findLegalReferences: plain text with no legal-reference span returns nothing", () => {
  assert.equal(
    findLegalReferences("This clause explains who gets paid and when for the design work.").length,
    0
  );
});

// ---- checkAnswer: R2 ------------------------------------------------------

const FIXTURE_STATUTE = {
  id: "st_fixture_verified_complete",
  act: "Fixture Act",
  act_no: "Act 000",
  provision: "s.1",
  label_en: "Fixture Act (Act 000), s.1",
  label_ms: "Akta Fixture (Akta 000), s.1",
};

test("checkAnswer: allows a citable statute's own label, s. vs section tolerant", () => {
  const withLabel = checkAnswer(
    "This is covered under Fixture Act (Act 000), s.1 of the law.",
    [FIXTURE_STATUTE]
  );
  assert.equal(withLabel.ok, true);
  assert.equal(withLabel.unmatched.length, 0);

  const withSpelledOutSection = checkAnswer(
    "This is covered under the Fixture Act, section 1.",
    [FIXTURE_STATUTE]
  );
  assert.equal(withSpelledOutSection.ok, true);
});

test("checkAnswer: blocks an invented section not in the allowed statutes", () => {
  const result = checkAnswer(
    "This means the client owns your work under section 99 of the Contracts Act 1950.",
    [FIXTURE_STATUTE]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.length > 0);
});

test("checkAnswer: blocks a real-looking but uncitable statute (not in allowedStatutes)", () => {
  // Contracts Act 1950 is a real Act, but it is not in this clause type's citable list, so
  // mentioning it is exactly as unattributable here as mentioning something invented.
  const result = checkAnswer("See the Contracts Act 1950, s.30 on this point.", [FIXTURE_STATUTE]);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.some((span) => /contracts act 1950/i.test(span)));
});

// ---- checkAnswer: boundary-aware containment (a partial number must not pass) ----
// Regression coverage for a hole where plain substring containment let "s.2" pass as if it
// were "s.26(2)", and "Act 3" pass as if it were "Act 332".

const REWORK_STATUTE = {
  act: "Copyright Act 1987",
  act_no: "Act 332",
  provision: "s.26(2)",
  label_en: "Copyright Act 1987 (Act 332), s.26(2)",
  label_ms: "Akta Hak Cipta 1987 (Akta 332), s.26(2)",
};

const REWORK_BLOCKED = [
  "Under section 2, the client owns it.",
  "See s. 2 for details.",
  "See Act 3 for details.",
  "See Act 33 for details.",
  "See s.255 for details.",
  "See section 26(3) for details.",
  "See the Copyright Act 1988 for details.",
  "See the Contracts Act 1950 for details.",
];

for (const sentence of REWORK_BLOCKED) {
  test(`checkAnswer: boundary-aware, blocks "${sentence}"`, () => {
    const result = checkAnswer(sentence, [REWORK_STATUTE]);
    assert.equal(result.ok, false, `expected "${sentence}" to be blocked`);
  });
}

const REWORK_ALLOWED = [
  "See s.26(2) for details.",
  "See section 26(2) for details.",
  "See s 26(2) for details.",
  "See section 26 for details.",
  "See the Copyright Act 1987 for details.",
  "See Act 332 for details.",
  "See Akta Hak Cipta 1987 for details.",
];

for (const sentence of REWORK_ALLOWED) {
  test(`checkAnswer: boundary-aware, allows "${sentence}"`, () => {
    const result = checkAnswer(sentence, [REWORK_STATUTE]);
    assert.equal(result.ok, true, `expected "${sentence}" to be allowed, got unmatched: ${JSON.stringify(result.unmatched)}`);
  });
}

// ---- checkAnswer: Act names with no year, and unsourced legal conclusions --------
// Regression coverage for a hole where an Act named without its year ("the Contracts Act")
// and unsourced legal conclusions ("under Malaysian law", "this is unenforceable") both slipped
// through as ok:true because nothing looked for them.

const REWORK2_BLOCKED = [
  "Under the Contracts Act, this is void.",
  "The Employment Act protects you.",
  "Akta Kontrak says so.",
  "Under Malaysian law this is unenforceable.",
];

for (const sentence of REWORK2_BLOCKED) {
  test(`checkAnswer: blocks unsourced Act names and legal conclusions in "${sentence}"`, () => {
    const result = checkAnswer(sentence, [REWORK_STATUTE]);
    assert.equal(result.ok, false, `expected "${sentence}" to be blocked`);
  });
}

test('checkAnswer: "the Copyright Act" (no year) is still allowed when that statute is allowed', () => {
  const result = checkAnswer("See the Copyright Act for details.", [REWORK_STATUTE]);
  assert.equal(result.ok, true, `expected to be allowed, got unmatched: ${JSON.stringify(result.unmatched)}`);
});

test('checkAnswer: "Akta Hak Cipta" (no year) is still allowed when that statute is allowed', () => {
  const result = checkAnswer("See Akta Hak Cipta for details.", [REWORK_STATUTE]);
  assert.equal(result.ok, true, `expected to be allowed, got unmatched: ${JSON.stringify(result.unmatched)}`);
});

test("checkAnswer: a plain practical sentence with no Act name or legal conclusion passes", () => {
  const result = checkAnswer("Ask the client to pay a deposit before you start.", []);
  assert.equal(result.ok, true);
  assert.equal(result.unmatched.length, 0);
});

test('checkAnswer: "Act" used as a verb at the start of a sentence is not mistaken for an Act name', () => {
  const result = checkAnswer("Act quickly if the client cancels.", []);
  assert.equal(result.ok, true);
  assert.equal(result.unmatched.length, 0);
});

test("checkAnswer: clean answer with no legal reference at all is always ok", () => {
  const result = checkAnswer("This clause is about who owns the finished artwork.", []);
  assert.equal(result.ok, true);
  assert.equal(result.unmatched.length, 0);
});
