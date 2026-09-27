# Citation gate alternatives (branch `gate-alternatives`)

Developed by Lutfitek. © 2026 Lutfitek. All rights reserved.

Started 2026-09-26 at Lutfi's request: assess US 12,353,469 B1, plan 10 alternatives to the
citation gate, build 5, benchmark, pick one for the public commit. Not legal advice. The patent
reading below is an engineer's reading of the claims, not a freedom-to-operate opinion.

## 1. The patent, US 12,353,469 B1 (Amazon Technologies, filed 2024-06-28, granted 2025-07-08)

"Verification and citation for language model outputs". 20 claims, 3 independent (1 system,
4 method, 16 storage medium). A product infringes only if it does every step of one claim.

Steps every independent claim needs:

| Step | Claim 1 | Claim 4 | Claim 16 | Suluh today |
|---|---|---|---|---|
| Extract text from a corpus, split into chunks | yes | yes | yes | No. Statutes are curated rows with one verified excerpt each, not a chunked corpus |
| Add temporal metadata to the chunks, index them | yes | yes | yes | No. `source_version` ("2024 Edition") is provenance on a row, never attached to chunks or used in retrieval |
| Embedding of the query, similarity search over chunk embeddings | yes | yes | only in dependent claim 18 | No. Clause matching is keyword scoring (`src/lib/match.js`); the vector seam is not built |
| LLM answer containing quantitative data points identified from the temporal metadata | yes | yes | yes | No. The gate checks legal-reference spans, not quantities, and nothing is picked by date |
| Verify the data point against a source document, return the answer plus that document as its source | yes | yes | yes | No. Suluh blocks an answer with an unmatched reference; it never attaches a source document to a verified number |
| Compare two sets of data points and substitute the source's value when they differ | no | dependent claim 6 | yes | No. Suluh never rewrites the model's answer |

Reading: Suluh's gate does not practise any independent claim. The gap is wide, not a
one-element miss. Two future changes would narrow it and need a patent attorney first:

1. The planned vector matching (`scoreByVectorSeam`) run over statute text split into chunks
   carrying edition or effective dates.
2. Any "auto-correct the citation" behaviour that swaps a wrong section number for the right one.
   That is claim 6 and claim 16's substitution step.

Design rules for every alternative below: no embeddings, no date-tagged chunks, no rewriting
of the model's answer (block or pass only), no second model query to verify the first.

## 2. Ten alternatives

| # | Alternative | Process improvement it targets | Built? | Why |
|---|---|---|---|---|
| G1 | Structured citation parser: parse each reference into {title, code, section, subsections} and compare parts | Fewer wrong-title passes ("17 U.S.C. § 2" vs "9 U.S.C. § 2"), fewer false blocks on odd formatting | Yes | Replaces substring tolerance with an exact, testable comparison |
| G2 | Alias index: every surface form of every citable statute generated at load time, exact lookup | Speed, auditability (a reviewer can read the alias list), fewer false blocks | Yes | Deterministic and explainable per statute |
| G3 | Hardened normalisation: Unicode NFKC, zero-width and bidi removal, look-alike characters, "Sec.", "United States Code", spelled-out numbers | Fewer leaks through obfuscated or unusual citation forms | Yes | Closes evasion routes the regexes cannot see |
| G4 | Wider legal-conclusion detector: paraphrased conclusions ("a court would not enforce", "you can sue", "legally required") | Fewer leaks of unsourced legal conclusions, today's largest gap | Yes | Unsourced conclusions carry no reference, so only this layer catches them |
| G5 | Excerpt grounding: an allowed citation must sit in a sentence sharing key terms with that statute's verified excerpt or topic | Catches a correct citation attached to a wrong claim (misattribution) | Yes | Lexical overlap only, no embeddings |
| G6 | Citation tokens: the model writes `[[law:id]]`, code renders the label; any free-form reference blocks | Removes citation parsing from the trust path | No | Needs a prompt change and a live model eval; best follow-up if the benchmark shows parsing limits |
| G7 | Sentence-level withholding: drop only the offending sentences | Fewer fully withheld answers | No | A partial answer can mislead by omission; breaks "block, never flag" |
| G8 | Second-model judge of legal claims | Catches paraphrase | No | Non-deterministic, slow, and a second verifying query moves toward claim 3 |
| G9 | Streaming sentence gate: release each checked sentence as it arrives | Time to first visible text | No | Text shown before a later sentence triggers a block cannot be unshown |
| G10 | Two independent detectors (regex plus a legal-vocabulary density scanner), block if either fires | Recall | No | Overlaps G3 and G4, doubles upkeep |

## 3. Benchmark

- Interface: every variant exports `checkAnswer(answer, allowedStatutes) -> {ok, unmatched}`, the
  same contract as `src/lib/citations.js`. Variants live in `src/lib/gates/`.
- Corpus: `bench/gate/corpus.json`, labelled `pass` or `block` with a category. The real Haiku
  answers from the 2026-09-26 live eval plus written cases. Split into `dev` and `heldout`;
  variant builders never saw it. Scores reported on `heldout`, `dev` shown for reference.
- Metrics: leaks (a `block` case passed), false blocks (a `pass` case blocked), per category,
  median and p95 time per check, lines of code.
- Selection rule, fixed before any variant was run: fewest held-out leaks; no category worse than
  the baseline; then fewest false blocks; then p95 time; then size.


## 4. Results (2026-09-26)

Corpus: 223 cases (106 pass, 117 block, 14 categories), 144 held-out and 79 dev. Held-out,
200 repetitions per timing. Full tables: `bench/gate/results/latest.md`.

| Gate | Held-out leaks | Held-out false blocks | Dev leaks | Dev false blocks | Median / p95 per check |
|---|---|---|---|---|---|
| **G4 conclusions (chosen)** | **11** | **9** | **8** | **9** | 60 / 156 µs |
| G5 grounding | 14 | 9 | 12 | 7 | 49 / 186 µs |
| G3 hardened normalisation | 17 | 9 | 16 | 7 | 82 / 251 µs |
| G2 alias index | 20 | 7 | 17 | 6 | 25 / 62 µs |
| G1 parser | 20 | 8 | 17 | 6 | 33 / 86 µs |
| Baseline (`citations.js`) | 20 | 9 | 17 | 7 | 33 / 127 µs |

Where each variant helps (held-out leaks, baseline to variant): G4 cuts paraphrased conclusions
11 to 3 and explicit conclusions 1 to 0. G5 cuts misattribution 4 to 0. G3 cuts obfuscated
citations 4 to 1. G1 and G2 leave leaks unchanged and remove 1 to 2 false blocks on correct
citations; G2 is the fastest.

Decision by the fixed rule: **G4**. Fewest held-out leaks, no category worse than the baseline
on held-out, and it blocks none of the 30 real model answers. It is now the live gate in
`src/routes/explain.js`. The other four stay in `src/lib/gates/` as benchmark entries only.

What G4 costs: on dev it adds 2 false blocks the baseline did not have (a contrived "the void
where feedback should be", and "might not hold up ... would need a lawyer to check", a borderline
hedge). On held-out it adds 1 (a correctly cited Federal Arbitration Act sentence that calls a
term "enforceable"), which is offset by the one baseline false block it removes.

Method notes, stated plainly:
- The held-out split was looked at once before a final G4 fix. That fix came from a real model
  answer in the dev split ("the client doesn't agree to protect you" was read as a legal
  conclusion). After the fix, held-out results for G4 did not change.
- The words embedding, vector and similarity flagged by the runner appear only in comments that
  say the gate uses none of them.
- The corpus was written by a separate agent from a written rule (`bench/gate/LABELLING.md`),
  blind to the variants; 24 held-out labels were re-read by the coordinator.

Stacking the layers (block if any blocks) was measured but not chosen, because the rule picks one
variant: G3 + G4 + G5 gives 3 held-out leaks and 10 false blocks (dev: 2 and 9). That is the
recommended next step, after a live model eval.

Remaining gaps for every gate: references inside the contract itself ("Section 4 of this
agreement") are blocked by all six (4 held-out false blocks), and "Freelance Isn't Free Act" is
cut to "Free Act" by the shared detector because of the apostrophe.
