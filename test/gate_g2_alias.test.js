// test/gate_g2_alias.test.js
//
// Unit tests for src/lib/gates/g2_alias.js (variant G2, "alias index"). Covers: correct
// citations in several surface forms (pass), a wrong title, a wrong section, a statute that is
// real but not in allowedStatutes, an empty allowed list, legal conclusions (block), ordinary
// prose (pass), the bare-form attribution decision (same section number, ambiguous vs.
// disambiguated by a second title in the same sentence), and a snapshot-style check of
// aliasesFor on a real seed statute.
// Developed by Lutfitek.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, aliasesFor, id, description } from "../src/lib/gates/g2_alias.js";

const COPYRIGHT_OWNERSHIP = {
  id: "st_work_made_for_hire_ownership",
  act: "Copyright Act (17 U.S.C.)",
  act_no: "17 U.S.C.",
  provision: "§ 201(b)",
  label_en: "17 U.S.C. § 201(b)",
  label_ms: "",
};

const ARBITRATION = {
  id: "st_arbitration_agreements_valid",
  act: "Federal Arbitration Act (9 U.S.C.)",
  act_no: "9 U.S.C.",
  provision: "§ 2",
  label_en: "9 U.S.C. § 2",
  label_ms: "",
};

const NY_PAYMENT = {
  id: "st_freelance_payment_timing",
  act: "New York General Business Law",
  act_no: "N.Y. Gen. Bus. Law",
  provision: "§ 1411",
  label_en: "N.Y. Gen. Bus. Law § 1411",
  label_ms: "",
};

const NY_CONTRACT_TIME_LIMITS = {
  id: "st_contract_claim_time_limits",
  act: "New York Civil Practice Law and Rules",
  act_no: "N.Y. C.P.L.R.",
  provision: "§ 213(2)",
  label_en: "N.Y. C.P.L.R. § 213(2)",
  label_ms: "",
};

// Shares its Act (and act_no) with ARBITRATION on purpose: this is the pair that exposed the
// "same title, different statute" false-block (see the "same-title exclusion" tests below).
const ARBITRATION_STAY = {
  id: "st_arbitration_stay",
  act: "Federal Arbitration Act (9 U.S.C.)",
  act_no: "9 U.S.C.",
  provision: "§ 3",
  label_en: "9 U.S.C. § 3",
  label_ms: "",
};

const SMALL_CLAIMS = {
  id: "st_small_claims",
  act: "New York City Civil Court Act",
  act_no: "N.Y.C. Civ. Ct. Act",
  provision: "§ 1801",
  label_en: "N.Y.C. Civ. Ct. Act § 1801",
  label_ms: "",
};

// ---- exports shape ----------------------------------------------------------------------

test("exports id and description", () => {
  assert.equal(id, "g2_alias");
  assert.equal(typeof description, "string");
  assert.ok(description.length > 0);
});

// ---- pass: correct citations in several formats -----------------------------------------

test("pass: exact label form", () => {
  const result = checkAnswer("See 17 U.S.C. § 201(b) on ownership.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unmatched, []);
});

test("pass: no-periods USC form", () => {
  const result = checkAnswer("Ownership follows 17 USC 201(b).", [COPYRIGHT_OWNERSHIP]);
  assert.equal(result.ok, true);
});

test("pass: 'title N section M' spelled-out form", () => {
  const result = checkAnswer(
    "This is governed by title 17 section 201(b).",
    [COPYRIGHT_OWNERSHIP]
  );
  assert.equal(result.ok, true);
});

test("pass: 'section M of the Copyright Act' form (both spans resolve)", () => {
  const result = checkAnswer(
    "This is covered by section 201(b) of the Copyright Act.",
    [COPYRIGHT_OWNERSHIP]
  );
  assert.equal(result.ok, true);
});

test("pass: bare act name alone, 'the Copyright Act'", () => {
  const result = checkAnswer("This is a matter for the Copyright Act generally.", [
    COPYRIGHT_OWNERSHIP,
  ]);
  assert.equal(result.ok, true);
});

test("pass: NY short form GBL with section mark", () => {
  const result = checkAnswer("You must be paid under GBL § 1411.", [NY_PAYMENT]);
  assert.equal(result.ok, true);
});

test("pass: NY spelled-out 'General Business Law section'", () => {
  // Deliberately not phrased as "under General Business Law...": the baseline's own
  // over-broad conclusion pattern (findLegalConclusions, "under <=2 words> law") treats
  // "General Business Law" as if it were "under [state] law" and blocks on its own, which is
  // baseline behaviour this variant reuses verbatim; there is no attribution step to fix it.
  const result = checkAnswer(
    "General Business Law section 1411 requires prompt payment.",
    [NY_PAYMENT]
  );
  assert.equal(result.ok, true);
});

test("aliasesFor recognises the NY common name 'Freelance Isn't Free Act'", () => {
  // Not exercised through checkAnswer: the baseline's Act-name detector
  // (ACT_NAME_NO_YEAR_RE in citations.js) only captures runs of [A-Z][a-zA-Z]* words, so the
  // apostrophe in "Isn't" splits the span, leaving just "Free Act" to attribute. That is
  // baseline detection behaviour this variant reuses unchanged, not something the attribution
  // step can repair. The alias itself is still generated and auditable here.
  const aliases = aliasesFor(NY_PAYMENT);
  assert.ok(aliases.includes("Freelance Isn't Free Act"));
  assert.ok(aliases.includes("Freelance Isn't Free Act § 1411"));
});

test("pass: CPLR abbreviation with section", () => {
  const result = checkAnswer("A claim is time-barred under CPLR 213(2).", [
    NY_CONTRACT_TIME_LIMITS,
  ]);
  assert.equal(result.ok, true);
});

test("pass: FAA abbreviation alone", () => {
  const result = checkAnswer("Arbitration clauses are enforceable under the FAA.", [
    ARBITRATION,
  ]);
  assert.equal(result.ok, true);
});

// ---- block: wrong title, wrong section, uncitable statute, empty list --------------------

test("block: wrong title, same section number as an allowed statute (different act)", () => {
  // "9 U.S.C. § 201(b)" is not a real citation; the allowed statute is 17 U.S.C. § 201(b).
  const result = checkAnswer("This is covered by 9 U.S.C. § 201(b).", [COPYRIGHT_OWNERSHIP]);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.length > 0);
});

test("block: wrong section number under the right act", () => {
  const result = checkAnswer(
    "You must be paid under section 1499 of the New York General Business Law.",
    [NY_PAYMENT]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.includes("section 1499"));
});

test("block: statute not in allowedStatutes (real but uncitable here)", () => {
  // NY_CONTRACT_TIME_LIMITS is a real statute, just not allowed for this clause type.
  const result = checkAnswer("A claim is time-barred under CPLR 213(2).", [NY_PAYMENT]);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.length > 0);
});

test("block: empty allowed list blocks every legal reference", () => {
  const result = checkAnswer("See 17 U.S.C. § 201(b).", []);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.length > 0);
});

test("block: invented Act with a year", () => {
  const result = checkAnswer(
    "This means the client owns your work under the Contracts Act 1950.",
    [COPYRIGHT_OWNERSHIP]
  );
  assert.equal(result.ok, false);
});

// ---- block: legal conclusions --------------------------------------------------------------

test("block: unsourced 'under X law' conclusion, even with an allowed statute present", () => {
  const result = checkAnswer(
    "This is void under New York law, see N.Y. Gen. Bus. Law § 1411.",
    [NY_PAYMENT]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.some((u) => u.startsWith("conclusion:")));
});

test("block: 'you have a right' conclusion", () => {
  const result = checkAnswer("You have a legal right to be paid on time.", [NY_PAYMENT]);
  assert.equal(result.ok, false);
});

// ---- pass: ordinary prose -------------------------------------------------------------------

test("pass: ordinary prose with no legal reference or conclusion", () => {
  const result = checkAnswer(
    "Payment is due within thirty days of the invoice date, with a late fee for overdue amounts.",
    [NY_PAYMENT]
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.unmatched, []);
});

test("pass: empty string answer", () => {
  const result = checkAnswer("", [NY_PAYMENT]);
  assert.equal(result.ok, true);
});

// ---- bare-form attribution decision ---------------------------------------------------------

test("bare form: allowed when only one allowed statute claims that section, alone", () => {
  const result = checkAnswer("This is covered under § 201(b).", [COPYRIGHT_OWNERSHIP]);
  assert.equal(result.ok, true);
});

test("bare form: blocked when a different allowed statute's title is named in the same sentence", () => {
  const result = checkAnswer(
    "9 U.S.C. governs but under § 201(b) it still applies.",
    [COPYRIGHT_OWNERSHIP, ARBITRATION]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.includes("§ 201(b)"));
});

test("bare form: allowed when the other title is named in a different sentence", () => {
  const result = checkAnswer(
    "The Federal Arbitration Act applies generally. Ownership is decided under § 201(b).",
    [COPYRIGHT_OWNERSHIP, ARBITRATION]
  );
  assert.equal(result.ok, true);
});

test("bare form: blocked when no allowed statute claims that bare section at all", () => {
  const result = checkAnswer("This is covered under § 9999.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(result.ok, false);
});

// ---- aliasesFor: audit list -----------------------------------------------------------------

test("aliasesFor: is sorted and returns a fresh array each call (no external mutation)", () => {
  const first = aliasesFor(NY_PAYMENT);
  const sorted = [...first].sort();
  assert.deepEqual(first, sorted);
  first.push("mutated");
  const second = aliasesFor(NY_PAYMENT);
  assert.ok(!second.includes("mutated"));
});

test("aliasesFor: snapshot check on st_freelance_payment_timing contains the expected forms", () => {
  const aliases = aliasesFor(NY_PAYMENT);
  const expected = [
    "N.Y. Gen. Bus. Law § 1411",
    "GBL § 1411",
    "Gen. Bus. Law § 1411",
    "General Business Law section 1411",
    "the Freelance Isn't Free Act",
    "New York General Business Law",
  ];
  for (const form of expected) {
    assert.ok(aliases.includes(form), `expected alias list to include "${form}"`);
  }
});

test("aliasesFor: does not invent an alias with the wrong section number", () => {
  const aliases = aliasesFor(NY_PAYMENT);
  assert.ok(!aliases.some((a) => a.includes("1412")));
});

// ---- rework: containment and the same-title exclusion --------------------------------------
//
// These cover the false block the coordinator found: with two allowed statutes sharing one
// Act (9 U.S.C., the Federal Arbitration Act, split across §2 and §3), a correctly-cited
// answer for one of them was blocked because the OTHER statute's title happens to be the same
// title, and the guard did not know to treat "same title as the citation's own statute" as
// harmless. Fixed by (1) skipping the guard entirely for a bare span that is only a substring
// of an already-resolved longer span at that position, and (2) excluding identity forms the
// claimant statute shares with itself from the "another title was named" check.

test("rework: full citation with a bare sub-span at the same position is not re-blocked by a sibling statute sharing the same title", () => {
  // findLegalReferences yields both "9 U.S.C. § 2" (direct hit) and "§ 2" (bare, same spot).
  // ARBITRATION_STAY shares the exact same Act and act_no as ARBITRATION, which is what
  // triggered the false block before the fix.
  const result = checkAnswer(
    "9 U.S.C. § 2 says a written arbitration term is valid and enforceable.",
    [ARBITRATION, ARBITRATION_STAY, SMALL_CLAIMS]
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.unmatched, []);
});

test("rework: a sibling statute citing its own different section still passes (no cross-block)", () => {
  const result = checkAnswer(
    "9 U.S.C. § 3 lets a court pause the lawsuit.",
    [ARBITRATION, ARBITRATION_STAY, SMALL_CLAIMS]
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.unmatched, []);
});

test("rework: identity-only and bare-section-only spans from one citation still resolve via the same-title exclusion", () => {
  const result = checkAnswer(
    "Section 2 of the Federal Arbitration Act makes the clause valid.",
    [ARBITRATION, ARBITRATION_STAY, SMALL_CLAIMS]
  );
  // No conclusion pattern fires here: findLegalConclusions has no rule for "makes ... valid"
  // (its is-void/is-enforceable rule requires "is" directly before the listed word, and "under
  // <=2 words> law" does not match either). Confirmed against citations.js directly.
  assert.equal(result.ok, true);
  assert.deepEqual(result.unmatched, []);
});

test("rework: wrong title (17 U.S.C. instead of 9 U.S.C.) still blocks despite a same-numbered allowed section existing", () => {
  const result = checkAnswer("17 U.S.C. § 2 applies here.", [
    ARBITRATION,
    ARBITRATION_STAY,
    SMALL_CLAIMS,
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.includes("17 U.S.C. § 2"));
});

test("rework: an Act with no citable statute in this clause type at all still blocks", () => {
  const result = checkAnswer("GBL § 1412 applies.", [ARBITRATION, ARBITRATION_STAY, SMALL_CLAIMS]);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.includes("GBL § 1412"));
});

test("rework: a genuinely different title named in the same sentence as a bare section still blocks it", () => {
  // Unlike ARBITRATION_STAY (same title as the claimant), SMALL_CLAIMS is a truly different
  // Act, so naming it alongside a bare, otherwise-unclaimed section number is a real conflict.
  const result = checkAnswer(
    "N.Y.C. Civ. Ct. Act governs small amounts, but § 2 also applies.",
    [ARBITRATION, SMALL_CLAIMS]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.includes("§ 2"));
});
