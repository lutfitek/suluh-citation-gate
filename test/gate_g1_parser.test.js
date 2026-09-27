// test/gate_g1_parser.test.js
//
// Unit tests for src/lib/gates/g1_parser.js (variant G1, the structured citation parser).
// Covers: correct citations in several US forms (pass), a wrong title, a wrong section, a
// statute that is real but not on this clause type's allowed list, an empty allowed list, an
// Act named with no section, a bare section disambiguated (or not) by context elsewhere in the
// answer, unsourced legal conclusions, case citations, and ordinary prose.
// Developed by Lutfitek.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, id, description } from "../src/lib/gates/g1_parser.js";

// ---- fixture statutes, shaped like seed/statutes.json --------------------------------------

const COPYRIGHT_OWNERSHIP = {
  id: "st_work_made_for_hire_ownership",
  act: "Copyright Act (17 U.S.C.)",
  act_no: "17 U.S.C.",
  provision: "§ 201(b)",
  label_en: "17 U.S.C. § 201(b)",
  source_title: "United States Code, 2024 Edition, Title 17",
};

const COPYRIGHT_DEFINITION = {
  id: "st_work_made_for_hire_meaning",
  act: "Copyright Act (17 U.S.C.)",
  act_no: "17 U.S.C.",
  provision: "§ 101",
  label_en: "17 U.S.C. § 101",
  source_title: "United States Code, 2024 Edition, Title 17",
};

const ARBITRATION_VALID = {
  id: "st_arbitration_agreements_valid",
  act: "Federal Arbitration Act (9 U.S.C.)",
  act_no: "9 U.S.C.",
  provision: "§ 2",
  label_en: "9 U.S.C. § 2",
  source_title: "United States Code, 2024 Edition, Title 9",
};

const FREELANCE_PAYMENT = {
  id: "st_freelance_payment_timing",
  act: "New York General Business Law",
  act_no: "N.Y. Gen. Bus. Law",
  provision: "§ 1411",
  label_en: "N.Y. Gen. Bus. Law § 1411",
  source_title: "New York General Business Law, article 44-A (Freelance Protection Act)",
};

const CONTRACT_TIME_LIMIT = {
  id: "st_contract_claim_time_limits",
  act: "New York Civil Practice Law and Rules",
  act_no: "N.Y. C.P.L.R.",
  provision: "§ 213(2)",
  label_en: "N.Y. C.P.L.R. § 213(2)",
};

const SMALL_CLAIMS = {
  id: "st_small_claims",
  act: "New York City Civil Court Act",
  act_no: "N.Y.C. Civ. Ct. Act",
  provision: "§ 1801",
  label_en: "N.Y.C. Civ. Ct. Act § 1801",
};

const LEGACY_NUMBERED_ACT = {
  id: "st_legacy_fixture",
  act: "Fixture Act",
  act_no: "Act 000",
  provision: "s.1",
  label_en: "Fixture Act (Act 000), s.1",
};

// ---- exports shape ---------------------------------------------------------------------------

test("exports id and description", () => {
  assert.equal(id, "g1_parser");
  assert.equal(typeof description, "string");
  assert.ok(description.length > 0);
});

// ---- correct citations, several formats (pass) -----------------------------------------------

test("pass: title and section together, § form", () => {
  const r = checkAnswer("See 17 U.S.C. § 201(b) for details.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: title and section together, spelled-out 'section'", () => {
  const r = checkAnswer("See 17 U.S.C. section 201(b) for details.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: section with no subsection stated is within a subsection-specific statute", () => {
  const r = checkAnswer("See 17 U.S.C. § 201 for details.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: bare section tied to its Act by 'of the <Act>'", () => {
  const r = checkAnswer("This is covered by section 201(b) of the Copyright Act.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: Act name only, no section stated", () => {
  const r = checkAnswer("This falls under the Federal Arbitration Act.", [ARBITRATION_VALID]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: GBL abbreviation", () => {
  const r = checkAnswer("See GBL § 1411 for details.", [FREELANCE_PAYMENT]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: General Business Law spelled out, no marker before the number", () => {
  const r = checkAnswer("See General Business Law 1411 for details.", [FREELANCE_PAYMENT]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: CPLR abbreviation with no marker before the number", () => {
  const r = checkAnswer("See CPLR 213(2) for details.", [CONTRACT_TIME_LIMIT]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: C.P.L.R. with periods and the § sign", () => {
  const r = checkAnswer("See C.P.L.R. § 213(2) for details.", [CONTRACT_TIME_LIMIT]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: NYC Civil Court Act abbreviation", () => {
  const r = checkAnswer("See N.Y.C. Civ. Ct. Act § 1801 for details.", [SMALL_CLAIMS]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: legacy numbered-Act form (Act NNN, no title/code)", () => {
  const r = checkAnswer("This is covered under Act 000, s.1 of the law.", [LEGACY_NUMBERED_ACT]);
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

test("pass: bare section disambiguated by an Act name mentioned elsewhere", () => {
  const r = checkAnswer(
    "Under the Copyright Act, § 201(b) says the employer is the author.",
    [COPYRIGHT_OWNERSHIP, ARBITRATION_VALID]
  );
  assert.equal(r.ok, true, JSON.stringify(r.unmatched));
});

// ---- wrong title, wrong section -------------------------------------------------------------

test("block: same section number, wrong title (17 U.S.C. vs 9 U.S.C.)", () => {
  const r = checkAnswer("See 9 U.S.C. § 201(b) for details.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
});

test("block: right title, wrong section", () => {
  const r = checkAnswer("See 17 U.S.C. § 999 for details.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
});

test("block: right title and section, wrong subsection", () => {
  const r = checkAnswer("See 17 U.S.C. § 201(c) for details.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
});

test("block: bare section with no context, ambiguous between two allowed titles", () => {
  const r = checkAnswer(
    "Section 2 covers this, and so does the surrounding law.",
    [
      { ...ARBITRATION_VALID }, // § 2 under 9 U.S.C.
      { ...COPYRIGHT_OWNERSHIP, provision: "§ 2", label_en: "17 U.S.C. § 2" }, // § 2 under 17 U.S.C.
    ]
  );
  assert.equal(r.ok, false);
});

test("block: bare section contradicted by a different title stated elsewhere", () => {
  const r = checkAnswer(
    "Elsewhere this deal cites 9 U.S.C. generally, but § 201(b) is what matters here.",
    [COPYRIGHT_OWNERSHIP]
  );
  assert.equal(r.ok, false);
});

// ---- statute not allowed, empty allowed list ------------------------------------------------

test("block: a real, correctly-formatted citation that is not on this clause type's allowed list", () => {
  const r = checkAnswer("See 17 U.S.C. § 201(b) for details.", [ARBITRATION_VALID]);
  assert.equal(r.ok, false);
});

test("block: Act name that is real but not allowed for this clause type", () => {
  const r = checkAnswer("This falls under the Federal Arbitration Act.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
});

test("block: empty allowed list blocks every legal reference", () => {
  const r = checkAnswer("See 17 U.S.C. § 201(b) for details.", []);
  assert.equal(r.ok, false);
});

test("block: empty allowed list still blocks an Act name alone", () => {
  const r = checkAnswer("This is covered by the Federal Arbitration Act.", []);
  assert.equal(r.ok, false);
});

// ---- legal conclusions (block) --------------------------------------------------------------

test("block: unsourced legal conclusion, 'under X law'", () => {
  const r = checkAnswer("Under New York law this arrangement is standard.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
  assert.ok(r.unmatched.some((s) => s.startsWith("conclusion: ")));
});

test("block: unsourced legal conclusion, 'is void'", () => {
  const r = checkAnswer("This clause is void as written.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
});

test("block: legal conclusion even with a correct citation present too", () => {
  const r = checkAnswer("Under 17 U.S.C. § 201(b) this is unenforceable.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
});

// ---- case citations and other unparseable spans ----------------------------------------------

test("block: case-style citation cannot be attributed to any statute", () => {
  const r = checkAnswer("As held in Acme Corp v Smith, this applies.", [COPYRIGHT_OWNERSHIP]);
  assert.equal(r.ok, false);
});

// ---- ordinary prose (pass) --------------------------------------------------------------------

test("pass: ordinary prose with no legal reference at all, non-empty allowed list", () => {
  const r = checkAnswer(
    "Ask the client to pay a deposit before you start the illustration work.",
    [COPYRIGHT_OWNERSHIP]
  );
  assert.equal(r.ok, true);
  assert.equal(r.unmatched.length, 0);
});

test("pass: ordinary prose, empty allowed list", () => {
  const r = checkAnswer("This clause explains who owns the finished artwork.", []);
  assert.equal(r.ok, true);
  assert.equal(r.unmatched.length, 0);
});

test("pass: 'Act' used as a verb at the start of a sentence is not mistaken for an Act name", () => {
  const r = checkAnswer("Act quickly if the client cancels the project.", []);
  assert.equal(r.ok, true);
  assert.equal(r.unmatched.length, 0);
});
