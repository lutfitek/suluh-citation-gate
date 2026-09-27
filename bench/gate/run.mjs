#!/usr/bin/env node
// bench/gate/run.mjs
//
// What this does: benchmarks the baseline citation gate (src/lib/citations.js) and every
// alternative gate in src/lib/gates/*.js against the labelled corpus in corpus.json, on a chosen
// split, and reports leaks, false blocks, accuracy, timing, size and a static-flag scan for each.
// What it must never do: let a gate that throws count as "passed" (a throw is a block, and is
// also reported as an error so it is not hidden inside a clean-looking leak count); let a corpus
// with zero variants present crash the runner (the baseline alone must always produce a report);
// mutate or rely on any variant's internals beyond its exported checkAnswer/id/description.
// Developed by Lutfitek.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const GATES_DIR = path.join(ROOT, "src", "lib", "gates");
const BASELINE_PATH = path.join(ROOT, "src", "lib", "citations.js");
const CORPUS_PATH = path.join(__dirname, "corpus.json");
const RESULTS_DIR = path.join(__dirname, "results");

// section: CLI args ------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { split: "heldout", reps: 200 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--split") {
      args.split = argv[++i];
    } else if (argv[i] === "--reps") {
      args.reps = Number(argv[++i]);
    }
  }
  if (!["heldout", "dev", "all"].includes(args.split)) {
    throw new Error(`--split must be heldout, dev or all (got ${args.split})`);
  }
  if (!Number.isInteger(args.reps) || args.reps < 1) {
    throw new Error(`--reps must be a positive integer (got ${args.reps})`);
  }
  return args;
}

// section: loading the corpus and statute table --------------------------------------------------

function loadCorpus() {
  const raw = fs.readFileSync(CORPUS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("corpus.json has no cases");
  }
  return parsed;
}

function loadStatuteMap() {
  const raw = fs.readFileSync(path.join(ROOT, "seed", "statutes.json"), "utf8");
  const parsed = JSON.parse(raw);
  const map = new Map();
  for (const statute of parsed) map.set(statute.id, statute);
  return map;
}

// Resolves a case's allowed statute ids to the full statute objects every checkAnswer
// implementation expects (act, act_no, provision, label_en, label_ms, topic_en, excerpt, ...).
// An id with no matching row is dropped rather than passed through as null: a gate cannot be
// asked to match against a statute that does not exist.
function resolveAllowed(ids, statuteMap) {
  return ids.map((id) => statuteMap.get(id)).filter(Boolean);
}

// section: loading gates --------------------------------------------------------------------------

async function loadBaseline() {
  const mod = await import(pathToFileURL(BASELINE_PATH).href);
  if (typeof mod.checkAnswer !== "function") {
    throw new Error("src/lib/citations.js does not export checkAnswer");
  }
  return { id: "baseline", description: "The shipped gate.", checkAnswer: mod.checkAnswer, filePath: BASELINE_PATH };
}

// Zero variants must still let the runner produce a report on the baseline alone, so a variant
// directory that is missing, empty, or contains a file that fails to import or does not export
// checkAnswer is skipped with a note on stderr rather than aborting the whole run.
async function loadVariants() {
  const variants = [];
  if (!fs.existsSync(GATES_DIR)) return variants;
  const entries = fs.readdirSync(GATES_DIR).filter((name) => name.endsWith(".js"));
  for (const name of entries) {
    const filePath = path.join(GATES_DIR, name);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      if (typeof mod.checkAnswer !== "function") {
        console.error(`bench/gate: skipping ${name}, no checkAnswer export`);
        continue;
      }
      const id = typeof mod.id === "string" && mod.id ? mod.id : path.basename(name, ".js");
      const description = typeof mod.description === "string" ? mod.description : "";
      variants.push({ id, description, checkAnswer: mod.checkAnswer, filePath });
    } catch (err) {
      console.error(`bench/gate: skipping ${name}, failed to import: ${err.message}`);
    }
  }
  return variants;
}

// section: running a single gate against the chosen cases ------------------------------------------

// A throw counts as block (the safe direction: an answer a gate cannot even evaluate must not
// reach the user), and is also recorded as an error so it never hides inside a clean-looking
// leak or false-block count.
function runOne(gate, testCase, resolvedAllowed) {
  const originalAnswer = testCase.answer;
  let ok;
  let errored = false;
  let errorMessage = null;
  try {
    const result = gate.checkAnswer(originalAnswer, resolvedAllowed);
    ok = Boolean(result && result.ok);
  } catch (err) {
    ok = false;
    errored = true;
    errorMessage = err && err.message ? err.message : String(err);
  }
  const mutated = testCase.answer !== originalAnswer;
  const predicted = ok ? "pass" : "block";
  return { predicted, errored, errorMessage, mutated };
}

function emptyCategoryBucket() {
  return { total: 0, passCases: 0, blockCases: 0, leaks: 0, falseBlocks: 0, errors: 0 };
}

function evaluateGate(gate, cases, statuteMap) {
  const byCategory = new Map();
  const leakedCaseIds = [];
  const falseBlockedCaseIds = [];
  const errorCaseIds = [];
  const mutatedCaseIds = [];
  let correct = 0;

  for (const testCase of cases) {
    const resolvedAllowed = resolveAllowed(testCase.allowed, statuteMap);
    const { predicted, errored, errorMessage, mutated } = runOne(gate, testCase, resolvedAllowed);

    if (!byCategory.has(testCase.category)) byCategory.set(testCase.category, emptyCategoryBucket());
    const bucket = byCategory.get(testCase.category);
    bucket.total++;
    if (testCase.label === "pass") bucket.passCases++;
    else bucket.blockCases++;

    if (errored) {
      errorCaseIds.push({ id: testCase.id, message: errorMessage });
      bucket.errors++;
    }
    if (mutated) mutatedCaseIds.push(testCase.id);

    const isLeak = testCase.label === "block" && predicted === "pass";
    const isFalseBlock = testCase.label === "pass" && predicted === "block";
    if (isLeak) {
      leakedCaseIds.push(testCase.id);
      bucket.leaks++;
    } else if (isFalseBlock) {
      falseBlockedCaseIds.push(testCase.id);
      bucket.falseBlocks++;
    } else {
      correct++;
    }
  }

  const byCategoryObj = {};
  for (const [category, bucket] of byCategory) byCategoryObj[category] = bucket;

  return {
    total: cases.length,
    correct,
    accuracy: cases.length ? correct / cases.length : 0,
    leaks: leakedCaseIds.length,
    falseBlocks: falseBlockedCaseIds.length,
    errors: errorCaseIds.length,
    leakedCaseIds,
    falseBlockedCaseIds,
    errorCaseIds,
    mutatedCaseIds,
    byCategory: byCategoryObj,
  };
}

// section: timing -----------------------------------------------------------------------------------
// One warm-up pass through the split (JIT warm-up, not timed), then --reps further passes, timing
// every single checkAnswer call with process.hrtime.bigint(). Median and p95 are computed over
// every individual call across every rep, so they describe the cost of one check, not one pass.

function timeGate(gate, cases, statuteMap, reps) {
  const resolvedByCase = cases.map((c) => resolveAllowed(c.allowed, statuteMap));

  // Warm-up: not timed, lets JIT compilation happen before measurement starts.
  for (let i = 0; i < cases.length; i++) {
    try {
      gate.checkAnswer(cases[i].answer, resolvedByCase[i]);
    } catch {
      // Timing does not care whether the gate throws, only how long it took to decide that.
    }
  }

  const durationsMicros = [];
  for (let rep = 0; rep < reps; rep++) {
    for (let i = 0; i < cases.length; i++) {
      const start = process.hrtime.bigint();
      try {
        gate.checkAnswer(cases[i].answer, resolvedByCase[i]);
      } catch {
        // Same reasoning as the warm-up pass: still timed, just not evaluated for correctness.
      }
      const end = process.hrtime.bigint();
      durationsMicros.push(Number(end - start) / 1000);
    }
  }

  durationsMicros.sort((a, b) => a - b);
  const median = percentile(durationsMicros, 0.5);
  const p95 = percentile(durationsMicros, 0.95);
  return { medianMicros: median, p95Micros: p95, samples: durationsMicros.length };
}

function percentile(sortedArray, fraction) {
  if (sortedArray.length === 0) return null;
  const index = Math.min(sortedArray.length - 1, Math.floor(fraction * sortedArray.length));
  return sortedArray[index];
}

// section: size --------------------------------------------------------------------------------------
// Non-blank, non-comment-only lines. A heuristic line-based scan, not a real parser: it tracks
// whether it is inside a /* ... */ block, and treats a line as counted only once anything other
// than whitespace or a comment remains on it after that block state is applied.

function countCodeLines(source) {
  let count = 0;
  let inBlockComment = false;
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (inBlockComment) {
      const closeIndex = line.indexOf("*/");
      if (closeIndex === -1) continue;
      inBlockComment = false;
      line = line.slice(closeIndex + 2).trim();
    }
    if (line === "") continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      const closeIndex = line.indexOf("*/", 2);
      if (closeIndex === -1) {
        inBlockComment = true;
        continue;
      }
      line = line.slice(closeIndex + 2).trim();
      if (line === "" || line.startsWith("//")) continue;
    }
    count++;
  }
  return count;
}

// Local imports from src/lib/ only: any relative import that resolves inside src/lib/, followed
// transitively (a gate that imports a helper that itself imports another local helper still
// counts all of it), each file counted once even if imported from more than one place.
const IMPORT_RE = /import\s+(?:[^'";]*?)\s+from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function localImportsOf(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const dir = path.dirname(filePath);
  const results = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] || match[2];
    if (!spec || !spec.startsWith(".")) continue;
    const resolved = path.resolve(dir, spec);
    if (fs.existsSync(resolved)) results.push(resolved);
  }
  return results;
}

function sizeOf(filePath) {
  const ownSource = fs.readFileSync(filePath, "utf8");
  const ownLines = countCodeLines(ownSource);

  const libRoot = path.join(ROOT, "src", "lib");
  const visited = new Set([path.resolve(filePath)]);
  const queue = localImportsOf(filePath).filter((p) => p.startsWith(libRoot));
  let importedLines = 0;
  while (queue.length > 0) {
    const next = queue.shift();
    const resolved = path.resolve(next);
    if (visited.has(resolved)) continue;
    visited.add(resolved);
    if (!resolved.startsWith(libRoot)) continue;
    if (!fs.existsSync(resolved)) continue;
    importedLines += countCodeLines(fs.readFileSync(resolved, "utf8"));
    for (const further of localImportsOf(resolved)) {
      if (!visited.has(path.resolve(further))) queue.push(further);
    }
  }

  return { ownLines, ownPlusImportsLines: ownLines + importedLines };
}

// section: static flags --------------------------------------------------------------------------
// Words that would suggest a gate has drifted toward the patent-adjacent territory this project
// deliberately avoids (see docs/GATE_ALTERNATIVES.md section 1): embeddings/vector similarity,
// a live network or subprocess call, or date-aware ("temporal") logic. This scans the gate's own
// file only, not anything it imports, since an import from src/lib/ is shared, reviewed code.
const FLAG_WORDS = ["embedding", "cosine", "vector", "similarity", "fetch(", "child_process", "temporal"];

function staticFlagsOf(filePath) {
  const source = fs.readFileSync(filePath, "utf8").toLowerCase();
  return FLAG_WORDS.filter((word) => source.includes(word));
}

// section: assembling the report ----------------------------------------------------------------------

function selectCases(corpus, split) {
  if (split === "all") return corpus.cases;
  return corpus.cases.filter((c) => c.split === split);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Citation gate benchmark results");
  lines.push("");
  lines.push("Developed by Lutfitek. © 2026 Lutfitek. All rights reserved.");
  lines.push("");
  lines.push(
    `Split: \`${report.split}\`. Cases: ${report.totalCases}. Reps: ${report.reps}. Generated: ${report.generatedAt}.`
  );
  lines.push("");
  lines.push("## Summary (sorted by leaks, then false blocks)");
  lines.push("");
  lines.push(
    "| gate | leaks | false blocks | accuracy | errors | median us | p95 us | own lines | own+imports lines | flags |"
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const g of report.gates) {
    lines.push(
      `| ${g.id} | ${g.metrics.leaks} | ${g.metrics.falseBlocks} | ${(g.metrics.accuracy * 100).toFixed(1)}% | ${g.metrics.errors} | ${fmt(g.timing.medianMicros)} | ${fmt(g.timing.p95Micros)} | ${g.size.ownLines} | ${g.size.ownPlusImportsLines} | ${g.staticFlags.length ? g.staticFlags.join(", ") : "none"} |`
    );
  }
  lines.push("");
  lines.push("## Per-category leaks and false blocks");
  lines.push("");
  const categories = Object.keys(report.gates[0]?.metrics.byCategory ?? {}).sort();
  const header = ["category", ...report.gates.map((g) => `${g.id} leaks`), ...report.gates.map((g) => `${g.id} false blocks`)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`|${header.map(() => "---").join("|")}|`);
  for (const category of categories) {
    const leakCells = report.gates.map((g) => g.metrics.byCategory[category]?.leaks ?? 0);
    const falseBlockCells = report.gates.map((g) => g.metrics.byCategory[category]?.falseBlocks ?? 0);
    lines.push(`| ${category} | ${leakCells.join(" | ")} | ${falseBlockCells.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function fmt(value) {
  return value === null || value === undefined ? "n/a" : value.toFixed(1);
}

// section: main -------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpus = loadCorpus();
  const statuteMap = loadStatuteMap();
  const cases = selectCases(corpus, args.split);
  if (cases.length === 0) {
    throw new Error(`no cases found for split ${args.split}`);
  }

  const baseline = await loadBaseline();
  const variants = await loadVariants();
  const gates = [baseline, ...variants];

  const gateReports = [];
  for (const gate of gates) {
    const metrics = evaluateGate(gate, cases, statuteMap);
    const timing = timeGate(gate, cases, statuteMap, args.reps);
    const size = sizeOf(gate.filePath);
    const staticFlags = staticFlagsOf(gate.filePath);
    gateReports.push({ id: gate.id, description: gate.description, metrics, timing, size, staticFlags });
  }

  gateReports.sort((a, b) => a.metrics.leaks - b.metrics.leaks || a.metrics.falseBlocks - b.metrics.falseBlocks);

  const report = {
    generatedAt: new Date().toISOString(),
    split: args.split,
    reps: args.reps,
    corpusVersion: corpus.version,
    totalCases: cases.length,
    gates: gateReports,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonPath = path.join(RESULTS_DIR, `${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");

  const markdown = buildMarkdown(report);
  fs.writeFileSync(path.join(RESULTS_DIR, "latest.md"), markdown + "\n");

  console.log(markdown);
  console.error(`bench/gate: wrote ${jsonPath}`);
}

main().catch((err) => {
  console.error(`bench/gate: ${err.stack || err.message}`);
  process.exitCode = 1;
});
