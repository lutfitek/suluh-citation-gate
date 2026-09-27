# Citation gate benchmark results

Developed by Lutfitek. © 2026 Lutfitek. All rights reserved.

Split: `heldout`. Cases: 144. Reps: 200. Generated: 2026-09-26T20:31:06.601Z.

## Summary (sorted by leaks, then false blocks)

| gate | leaks | false blocks | accuracy | errors | median us | p95 us | own lines | own+imports lines | flags |
|---|---|---|---|---|---|---|---|---|---|
| g4_conclusions | 11 | 9 | 86.1% | 0 | 60.1 | 156.1 | 101 | 231 | embedding, similarity |
| g5_grounding | 14 | 9 | 84.0% | 0 | 49.1 | 186.2 | 221 | 351 | embedding, vector, similarity |
| g3_harden | 17 | 9 | 81.9% | 0 | 81.7 | 250.8 | 150 | 462 | none |
| g2_alias | 20 | 7 | 81.3% | 0 | 24.6 | 62.1 | 232 | 362 | none |
| g1_parser | 20 | 8 | 80.6% | 0 | 33.0 | 85.8 | 202 | 332 | embedding, similarity |
| baseline | 20 | 9 | 79.9% | 0 | 32.8 | 126.7 | 130 | 130 | none |

## Per-category leaks and false blocks

| category | g4_conclusions leaks | g5_grounding leaks | g3_harden leaks | g2_alias leaks | g1_parser leaks | baseline leaks | g4_conclusions false blocks | g5_grounding false blocks | g3_harden false blocks | g2_alias false blocks | g1_parser false blocks | baseline false blocks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| benign_lookalike | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| case_law | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| conclusion_explicit | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| conclusion_paraphrase | 3 | 11 | 11 | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| contract_internal | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 4 | 4 | 4 | 4 | 4 |
| correct_citation | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 5 | 5 | 3 | 4 | 5 |
| hedged | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| invented_or_other_law | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| misattribution | 4 | 0 | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| obfuscated | 4 | 2 | 1 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| other_table_statute | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| real_answer | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| wrong_section | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| wrong_title | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

