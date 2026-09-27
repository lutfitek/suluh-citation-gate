// test/gate_g5_grounding.test.js
//
// What this does: unit tests for src/lib/gates/g5_grounding.js, the excerpt-grounding citation
// gate variant (G5, see docs/GATE_ALTERNATIVES.md). Covers: the baseline's own checks still run
// first and are unchanged (no citation at all, an unattributable citation); a correctly-cited,
// on-topic sentence passes; a correctly-cited but off-topic sentence (misattribution) is blocked;
// the "citation ends its own sentence, claim is in the next one" carry-over rule, both when the
// next sentence is on-topic and when it is not; and the short-sentence lower threshold.
// Every case uses a real statute row from seed/statutes.json, the same table the live app reads.
// What it must never do: assert on anything the baseline gate already owns (that is
// test/citations.test.js's job); this file only asserts on the grounding layer's own behaviour.
// Developed by Lutfitek.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkAnswer, id, description } from "../src/lib/gates/g5_grounding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const statutes = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "seed", "statutes.json"), "utf8"));

function byId(statuteId) {
  const statute = statutes.find((s) => s.id === statuteId);
  assert.ok(statute, `fixture statute "${statuteId}" not found in seed/statutes.json`);
  return statute;
}

const ST_TRANSFER_WRITING = byId("st_transfer_in_writing");
const ST_PAYMENT_TIMING = byId("st_freelance_payment_timing");
const ST_ARBITRATION_VALID = byId("st_arbitration_agreements_valid");
const ST_WMFH_OWNERSHIP = byId("st_work_made_for_hire_ownership");
const ST_WRITTEN_CONTRACT = byId("st_freelance_written_contract");
const ST_SMALL_CLAIMS = byId("st_small_claims");
const ST_RETALIATION = byId("st_freelance_retaliation");
const ST_TIME_LIMITS = byId("st_contract_claim_time_limits");
const ST_VISUAL_ART_ATTRIBUTION = byId("st_visual_art_attribution");
const ST_TERMINATION_TRANSFERS = byId("st_termination_of_transfers");
const ST_WORKER_MEANING = byId("st_freelance_worker_meaning");

// section: sanity on the exported shape ------------------------------------------------

test("g5_grounding: exports id and a one-line description", () => {
  assert.equal(id, "g5_grounding");
  assert.equal(typeof description, "string");
  assert.ok(description.length > 0);
});

// section: baseline behaviour passes through unchanged ------------------------------------------------

test("g5: no legal reference at all is unchanged (ok, no unmatched)", () => {
  const result = checkAnswer("This clause is about who owns the finished artwork.", []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unmatched, []);
});

test("g5: a plain practical sentence with no citation passes", () => {
  const result = checkAnswer("Ask the client to pay a deposit before you start.", [ST_PAYMENT_TIMING]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unmatched, []);
});

test('g5: "Act" used as a verb at a sentence start is not mistaken for a citation', () => {
  const result = checkAnswer("Act quickly if the client cancels.", []);
  assert.equal(result.ok, true);
});

test("g5: an unsourced legal conclusion still blocks (baseline's own rule, untouched)", () => {
  const result = checkAnswer("Under New York law this is unenforceable.", [ST_PAYMENT_TIMING]);
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.some((s) => s.startsWith("conclusion:")));
});

test("g5: a citation not in the allowed statutes still blocks (baseline's own rule, untouched)", () => {
  const result = checkAnswer(
    "See the Contracts Act 1950, s.30 on this point.",
    [ST_PAYMENT_TIMING]
  );
  assert.equal(result.ok, false);
  assert.ok(result.unmatched.some((s) => /contracts act 1950/i.test(s)));
});

// section: correctly cited AND on topic, must pass ------------------------------------------------

const GROUNDED_CASES = [
  {
    name: "writing requirement cited for a writing/signature claim",
    statute: ST_TRANSFER_WRITING,
    answer:
      "The agreement only transfers copyright ownership if it is in writing and signed by you, " +
      "under 17 U.S.C. § 204(a).",
  },
  {
    name: "payment timing cited for a payment deadline claim",
    statute: ST_PAYMENT_TIMING,
    answer:
      "Under N.Y. Gen. Bus. Law § 1411, the client must pay your compensation within thirty days " +
      "of you completing the work.",
  },
  {
    name: "arbitration validity cited for an arbitration enforceability claim",
    statute: ST_ARBITRATION_VALID,
    answer:
      "Under 9 U.S.C. § 2, a written arbitration agreement like this one is generally valid and " +
      "enforceable.",
  },
  {
    name: "work-made-for-hire ownership cited for an ownership claim",
    statute: ST_WMFH_OWNERSHIP,
    answer:
      "Under 17 U.S.C. § 201(b), the party who commissioned this work made for hire is considered " +
      "the author and owns the copyright.",
  },
  {
    name: "written contract requirement cited for a written-contract claim",
    statute: ST_WRITTEN_CONTRACT,
    answer:
      "Under N.Y. Gen. Bus. Law § 1412, the hiring party must give you a written contract listing " +
      "the services and the rate of compensation.",
  },
  {
    name: "small claims cited for a small claims venue claim",
    statute: ST_SMALL_CLAIMS,
    answer:
      "Under N.Y.C. Civ. Ct. Act § 1801, you can bring a small claims case in New York City for " +
      "amounts up to ten thousand dollars.",
  },
  {
    name: "retaliation protection cited for a retaliation claim",
    statute: ST_RETALIATION,
    answer:
      "Under N.Y. Gen. Bus. Law § 1413, the hiring party cannot penalise you or deny you future " +
      "work for exercising these rights.",
  },
  {
    name: "time limit cited for a filing deadline claim",
    statute: ST_TIME_LIMITS,
    answer:
      "Under N.Y. C.P.L.R. § 213(2), you generally have six years to bring a claim over an unpaid " +
      "invoice under this contract.",
  },
  {
    name: "visual art attribution cited for a name/credit claim",
    statute: ST_VISUAL_ART_ATTRIBUTION,
    answer:
      "Under 17 U.S.C. § 106A(a), you may keep the right to claim authorship and have your name " +
      "credited on a work of visual art.",
  },
  {
    name: "termination of transfers cited for an ending-the-license-after-years claim",
    statute: ST_TERMINATION_TRANSFERS,
    answer:
      "Under 17 U.S.C. § 203(a), you may be able to terminate this license after thirty-five years.",
  },
];

for (const { name, statute, answer } of GROUNDED_CASES) {
  test(`g5: passes, ${name}`, () => {
    const result = checkAnswer(answer, [statute]);
    assert.equal(result.ok, true, `expected pass, got unmatched: ${JSON.stringify(result.unmatched)}`);
  });
}

// section: correctly cited but attached to an UNRELATED claim, must block ------------------------

const MISATTRIBUTED_CASES = [
  {
    name: "writing requirement cited to support a payment-timing claim",
    statute: ST_TRANSFER_WRITING,
    answer: "Under 17 U.S.C. § 204(a) the client must pay you within 30 days.",
  },
  {
    name: "payment timing cited to support an ownership claim",
    statute: ST_PAYMENT_TIMING,
    answer: "Under N.Y. Gen. Bus. Law § 1411, the client owns all copyright in your work forever.",
  },
  {
    name: "arbitration validity cited to support a filing-deadline claim",
    statute: ST_ARBITRATION_VALID,
    answer: "Under 9 U.S.C. § 2, you must submit a list of completed services within seven days.",
  },
  {
    name: "visual art attribution cited to support a writing/signature claim",
    statute: ST_VISUAL_ART_ATTRIBUTION,
    answer: "Under 17 U.S.C. § 106A(a), the contract must be reduced to writing and signed by both parties.",
  },
  {
    name: "small claims venue cited to support a retaliation claim",
    statute: ST_SMALL_CLAIMS,
    answer: "Under N.Y.C. Civ. Ct. Act § 1801, the hiring party cannot retaliate against you.",
  },
  {
    name: "termination-of-transfer cited to support a deposit-refund claim",
    statute: ST_TERMINATION_TRANSFERS,
    answer: "Under 17 U.S.C. § 203(a), the deposit is non-refundable if you cancel the project.",
  },
  {
    name: "freelance-worker-meaning cited to support an arbitration-venue claim",
    statute: ST_WORKER_MEANING,
    answer: "Under N.Y. Gen. Bus. Law § 1410(3), any dispute must be arbitrated in Singapore.",
  },
];

for (const { name, statute, answer } of MISATTRIBUTED_CASES) {
  test(`g5: blocks, ${name}`, () => {
    const result = checkAnswer(answer, [statute]);
    assert.equal(result.ok, false, `expected block for: ${answer}`);
    assert.ok(
      result.unmatched.some((s) => s.startsWith(`misattributed: `) && s.includes(statute.id)),
      `expected a misattributed entry naming ${statute.id}, got: ${JSON.stringify(result.unmatched)}`
    );
  });
}

// section: "citation ends its own sentence" carry-over to the next sentence ----------------------

test("g5: citation ending its own sentence is grounded by an on-topic next sentence", () => {
  const result = checkAnswer(
    "This clause relies on N.Y. Gen. Bus. Law § 1411. It requires the client to pay you within " +
      "thirty days of finishing your work.",
    [ST_PAYMENT_TIMING]
  );
  assert.equal(result.ok, true, `expected pass, got unmatched: ${JSON.stringify(result.unmatched)}`);
});

test("g5: citation ending its own sentence is NOT saved by an off-topic next sentence", () => {
  const result = checkAnswer(
    "This clause relies on N.Y. Gen. Bus. Law § 1411. It requires you to arbitrate any dispute " +
      "in Singapore.",
    [ST_PAYMENT_TIMING]
  );
  assert.equal(result.ok, false, `expected block, got: ${JSON.stringify(result.unmatched)}`);
  assert.ok(result.unmatched.some((s) => s.includes(ST_PAYMENT_TIMING.id)));
});

// section: short-sentence lower threshold (1 shared term, sentence under 12 words) ---------------

test("g5: a short, clearly on-topic sentence passes at the lower (1-term) threshold", () => {
  const result = checkAnswer("Payment is due under N.Y. Gen. Bus. Law § 1411.", [ST_PAYMENT_TIMING]);
  assert.equal(result.ok, true, `expected pass, got unmatched: ${JSON.stringify(result.unmatched)}`);
});

test("g5: a short, clearly off-topic sentence still blocks even at the lower threshold", () => {
  const result = checkAnswer("Arbitrate under N.Y. Gen. Bus. Law § 1411.", [ST_PAYMENT_TIMING]);
  assert.equal(result.ok, false, `expected block, got: ${JSON.stringify(result.unmatched)}`);
});

// section: multiple allowed statutes, span attributes to the right one ---------------------------

test("g5: with several allowed statutes, an on-topic citation for one of them still passes", () => {
  const result = checkAnswer(
    "Under N.Y. Gen. Bus. Law § 1411, the client must pay you within thirty days.",
    [ST_PAYMENT_TIMING, ST_TIME_LIMITS, ST_RETALIATION]
  );
  assert.equal(result.ok, true, `expected pass, got unmatched: ${JSON.stringify(result.unmatched)}`);
});

test("g5: with several allowed statutes, an off-topic citation for the matched one still blocks", () => {
  const result = checkAnswer(
    "Under N.Y. Gen. Bus. Law § 1411, the hiring party cannot retaliate against you.",
    [ST_PAYMENT_TIMING, ST_TIME_LIMITS, ST_RETALIATION]
  );
  assert.equal(result.ok, false, `expected block, got: ${JSON.stringify(result.unmatched)}`);
  assert.ok(result.unmatched.some((s) => s.includes(ST_PAYMENT_TIMING.id)));
});

// section: same citation text appearing twice, once grounded once not ---------------------------

test("g5: the same citation repeated in the answer is checked at each occurrence independently", () => {
  const result = checkAnswer(
    "Under N.Y. Gen. Bus. Law § 1411, the client must pay you within thirty days. Separately, " +
      "under N.Y. Gen. Bus. Law § 1411, the client owns all copyright in your work forever.",
    [ST_PAYMENT_TIMING]
  );
  assert.equal(result.ok, false, `expected block on the second occurrence, got: ${JSON.stringify(result.unmatched)}`);
});
