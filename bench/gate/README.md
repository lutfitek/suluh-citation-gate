# Citation gate benchmark

Developed by Lutfitek. © 2026 Lutfitek. All rights reserved.

This benchmarks the baseline citation gate (`src/lib/citations.js`) against any alternative
gates in `src/lib/gates/*.js`, on a labelled corpus of clause explanations. See
`docs/GATE_ALTERNATIVES.md` for why these alternatives exist and the selection rule that decides
which one, if any, replaces the baseline.

## What is here

- `LABELLING.md`: the rule the corpus was labelled against, written and frozen before any case
  was labelled.
- `corpus.json`: the labelled cases. Each case has `id`, `split` (`dev` or `heldout`),
  `clause_type_id`, `allowed` (the citable statute ids for that clause type), `answer`, `label`
  (`pass` or `block`), `category`, and a `note` on why it was labelled that way. It includes every
  usable real answer from the 2026-09-26 live eval (`real_answer`) plus hand-written cases across
  thirteen other categories: correctly cited statutes in varied formats, wrong-title citations,
  wrong-section citations, a real statute that just is not on this clause type's allowed list,
  invented or out-of-table law, case names, obfuscated citations (zero-width characters,
  look-alike Unicode letters, spelled-out numbers, and so on), explicit and paraphrased unsourced
  legal conclusions, misattribution (a real, allowed citation attached to a claim it does not
  support), contract-internal references, benign look-alike vocabulary, and hedged language.
- `run.mjs`: the runner.
- `results/`: one timestamped JSON file per run, plus `results/latest.md`, the summary of the
  most recent run.

## Running it

```
node bench/gate/run.mjs [--split heldout|dev|all] [--reps 200]
```

Defaults to `--split heldout --reps 200`. `heldout` is the split that decides which gate wins
(see the selection rule in `docs/GATE_ALTERNATIVES.md`); `dev` is shown for reference only, since
whoever built each variant could see it while building; `all` runs everything.

The runner always benchmarks the baseline. If `src/lib/gates/` has no files, or a file in it does
not export a working `checkAnswer`, that file is skipped with a note on stderr and the run still
completes on whatever gates remain.

## Reading the results

- **Leaks**: a `block`-labelled case the gate marked `pass`. The number that matters most: a leak
  is a legal reference or an unsourced legal conclusion reaching the reader.
- **False blocks**: a `pass`-labelled case the gate marked `block`. Costly, but the safe direction
  to be wrong in: the reader sees nothing instead of seeing something risky.
- **Accuracy**: correct predictions over total cases in the split.
- **Errors**: how many cases made the gate throw. A throw is still scored as a `block` (the safe
  outcome), but is counted here separately so a gate cannot look clean by crashing on the cases
  it cannot handle.
- **Median / p95 microseconds**: the cost of a single `checkAnswer` call, timed with
  `process.hrtime.bigint()` across one warm-up pass (discarded) and `--reps` further passes
  through the split. Every individual call's duration goes into one distribution; median and p95
  are read off that distribution, so they describe one check, not one full pass.
- **Own lines / own+imports lines**: non-blank, non-comment-only lines in the gate's own file,
  and the same count including any local file it imports from `src/lib/` (transitively).
- **Flags**: any of `embedding`, `cosine`, `vector`, `similarity`, `fetch(`, `child_process`,
  `temporal` found in the gate's own source, case-insensitive. These are the directions
  `docs/GATE_ALTERNATIVES.md` ruled out (patent-adjacent techniques, or non-deterministic and
  slow ones); a flag on a variant is worth a second look, not an automatic disqualification.
- **Per-category table**: leaks and false blocks broken down by the corpus categories above, so
  a gate that trades one weakness for another (for example, fewer obfuscated leaks but more false
  blocks on `hedged`) is visible rather than averaged away.

The JSON file behind `latest.md` (`results/<ISO timestamp>.json`) carries everything the
markdown summarises, plus the actual case ids each gate leaked or falsely blocked, so a specific
failure can be pulled up and read against `LABELLING.md` and the corpus.
