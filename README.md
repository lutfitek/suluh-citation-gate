# Suluh citation gate

Developed by Lutfitek. © 2026 Lutfitek. All rights reserved.

The output check from Suluh, an experimental tool that explains contract clauses to freelancers
in plain English. A language model writes the explanation. Before anyone sees it, this gate
decides pass or block. It blocks the whole answer if it:

- names a law that is not on the approved list for that clause, or
- states a legal verdict nobody sourced ("this clause is void", "a court would not enforce this").

It never rewrites the answer. It passes it or withholds it.

Nothing here is legal advice.

## What is in this repo

| Path | What it is |
|---|---|
| `src/lib/citations.js` | The original gate (the baseline) |
| `src/lib/gates/g4_conclusions.js` | **G4, the live gate.** The baseline's law check plus a wider check for legal verdicts |
| `src/lib/gates/g1_parser.js`, `g2_alias.js`, `g5_grounding.js` | Three of the other alternatives that were built and benchmarked |
| `docs/GATE_ALTERNATIVES.md` | The design notes: a reading of US 12,353,469 B1, ten alternatives, the benchmark method and results |
| `bench/gate/` | The labelled benchmark (223 cases), the labelling rule, the runner and the results |
| `test/` | Tests for the baseline and the gates |

Not included, on purpose: the rest of the Suluh app, its clause library, its prompts, its
prompt-injection defences and its statute table. A fifth alternative (G3, hardened handling of
disguised citations) is described in the design notes but not published here.

## How G4 works, in short

It keeps the baseline's check on named laws unchanged. For verdicts, it cuts each sentence into
pieces and blocks a piece that has both a legal outcome word (enforce, void, illegal, sue, liable,
entitled, "a court would", "protected by law") and a statement of fact (is, would, will, can,
could). A piece that hands the question to a lawyer ("ask a lawyer whether this is enforceable")
passes. Softening words like "likely" do not count as handing it over.

Benchmark on 144 held-out cases (a leak is a bad answer shown; a false block is a good answer
withheld):

| Gate | Leaks | False blocks |
|---|---|---|
| G4 conclusions | 11 | 9 |
| G5 grounding | 14 | 9 |
| G3 hardened (not published) | 17 | 9 |
| G2 alias index | 20 | 7 |
| G1 parser | 20 | 8 |
| Baseline | 20 | 9 |

Full tables: `bench/gate/results/latest.md`.

## Run it

Node 24, no dependencies.

```
npm test
```

Runs the tests for the baseline, G1, G2 and G4. Two things need the statute table, which is not
published: `test/gate_g5_grounding.test.js` and the benchmark runner `bench/gate/run.mjs`. Both
read `seed/statutes.json`, an array of rows shaped
`{id, act, act_no, provision, label_en, label_ms, topic_en, excerpt}`. Supply your own to run them.
