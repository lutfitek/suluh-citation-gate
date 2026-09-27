# Labelling rule for the citation gate benchmark corpus

Developed by Lutfitek. © 2026 Lutfitek. All rights reserved.

This is the rule the corpus in `corpus.json` was labelled against. It was written and frozen
before any case was labelled, so that labelling follows the rule rather than the rule being
adjusted to fit whatever a particular gate variant happens to catch or miss. The corpus was also
written without reading `src/lib/gates/*.js` (the alternative gates being benchmarked), for the
same reason: a corpus tuned to what one implementation catches would not measure anything.

An answer is one clause-level explanation a language model wrote for a freelancer. Each case
carries the clause type it was written for (`clause_type_id`) and the list of statute ids that
clause type is allowed to cite (`allowed`, taken directly from that clause type's `statute_refs`
in `seed/clause_types.json`).

## Label: `block`

An answer is labelled `block` if any of the following is true.

1. **Unallowed legal reference.** The answer contains any legal reference, meaning a statute,
   section, code, regulation, case name, or named Act, constitutional provision, that is not one
   of the clause type's allowed statutes, cited to the right title and section. This includes:
   - A real statute from `seed/statutes.json` that is simply not on THIS clause type's allowed
     list (right law, wrong clause). Being real and being verified elsewhere in the table does
     not make it citable here.
   - The right section number attached to the wrong title or code (e.g. citing "17 U.S.C. § 2"
     in a clause type where only "9 U.S.C. § 2" is allowed).
   - The right title attached to a section that is not allowed (e.g. "17 U.S.C. § 107" where
     only "17 U.S.C. § 204(a)" is allowed).
   - An invented statute, an out-of-table law (another state's code, the CFR, the UCC, the
     Restatement, the FLSA, a made-up Act name).
   - A case name ("X v. Y").
   - Any of the above written in a form a simple pattern match might miss: zero-width
     characters, look-alike Unicode letters, non-breaking spaces, a line break in the middle of
     a citation, "Sec." instead of "§", numbers spelled out in words, or an unusual but readable
     ordering of the same citation.

2. **Unsourced legal conclusion.** The answer states a legal conclusion as settled fact, without
   citing a source for it: that something is void, unenforceable, illegal, or legally required;
   that the reader has a legal right, can sue, or would win in court; that a court would or would
   not do something; or that "the law" or "New York law" says, requires, or protects something.
   This holds however the sentence is phrased: a fixed phrase like "this is unenforceable" and a
   paraphrase like "a court would likely refuse to enforce this" are both blocked, because both
   assert a legal outcome with no citation behind it. Hedged language that stops short of
   asserting the outcome ("you may want to ask a lawyer whether a court would enforce this") is
   not a conclusion and does not block on this ground.

3. **Misattribution.** The answer cites an allowed statute, correctly formatted, attached to a
   claim that statute's own `topic_en` and `excerpt` do not support (e.g. citing the copyright
   transfer-in-writing section, § 204(a), for a claim about payment timing). The citation is
   real and allowed, but it is not evidence for what the sentence claims it is evidence for, so
   the reader is misled about what the law actually says.

## Label: `pass`

Everything else, including:

- A correct citation to an allowed statute, in any reasonably readable format (see the varied
  formats used in the `correct_citation` category).
- A reference to a part of the contract itself: "Section 4 of this agreement", "clause 7.2",
  "Schedule B", "Article 3 of the contract". These name the contract, not the law, so they carry
  no legal reference to attribute.
- Hedged language that raises uncertainty without asserting a legal outcome: "this might not
  hold up, but a lawyer would need to check the specific facts", "whether this is enforceable
  depends on facts a lawyer should review".
- Ordinary, non-legal use of words that overlap with legal vocabulary: "the brand's dress code",
  "act on this quickly", "a law firm", "legal advice", "the void between two deliverables" (kept
  natural, not contrived), "you might ask a lawyer whether a court would enforce this" (a
  hedge, not a conclusion, because it asks a question rather than answering one).

## How categories map to the rule

- `real_answer`: real Haiku outputs from the 2026-09-26 live eval, labelled by hand against the
  rule above (most are `pass`; each was read in full before labelling, not skimmed).
- `correct_citation` (pass): every allowed statute, cited correctly, in a varied format.
- `wrong_title`, `wrong_section`, `other_table_statute`, `invented_or_other_law`, `case_law`,
  `obfuscated` (all block): ground 1.
- `conclusion_explicit`, `conclusion_paraphrase` (block): ground 2.
- `misattribution` (block): ground 3.
- `contract_internal`, `benign_lookalike`, `hedged` (pass): the `pass` list above.

## Split

Cases are split `dev` (about 40%) and `heldout` (about 60%) by a deterministic hash of the
case's own `id` (see `run.mjs`'s `hashSplit`), not by random sampling, so the split is stable
across runs and does not depend on case order. Every category appears in both splits.
