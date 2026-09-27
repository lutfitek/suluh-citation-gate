// src/lib/gates/g5_grounding.js
//
// What this does: a second citation layer on top of the baseline gate (src/lib/citations.js).
// The baseline already blocks any legal reference that cannot be attributed to one of the
// clause type's allowed statutes. This layer catches a different failure: a citation that IS a
// real, allowed statute, but is glued onto a sentence about something that statute does not
// cover (e.g. citing the copyright-transfer-writing rule to support a payment-timing claim).
// That is misattribution, not fabrication, so the baseline's own containment check cannot see
// it: the span itself matches a statute's label just fine.
// What it must never do: rewrite, correct or relabel the citation or the answer; run an
// embedding, vector or similarity-scoring library; make a network or model call; treat a
// legal-conclusion span (no reference to attribute in the first place) as its concern, since
// the baseline already blocks those unconditionally. Pass or block only.
// Hard requirement served: R2 (no legal reference reaches the user unless it is both from the
// verified statute table AND actually supports the sentence it sits in).
// Developed by Lutfitek.

import { checkAnswer as baselineCheckAnswer, findLegalReferences } from "../citations.js";

export const id = "g5_grounding";
export const description =
  "Blocks an allowed citation when the sentence citing it shares too few key terms with that " +
  "statute's own topic/excerpt, catching a correct citation attached to a claim it does not support.";

// section: minimal matching logic, copied from citations.js -----------------------------------
// Provenance: this is a trimmed copy of citations.js's normalize/occursWithBoundary/
// spanMatchesStatute (not exported there), needed here to redo the same "which allowed statute
// does this span belong to" attribution the baseline gate already did internally, so this layer
// can look up that specific statute's key terms. Kept byte-for-byte equivalent in behaviour;
// any future change to the baseline's matching rules should be mirrored here.

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/\bsections?\b/g, "s.")
    .replace(/\bseksyen\b/g, "s.")
    .replace(/\bu\.?\s?s\.?\s?c\b\.?/g, "u.s.c.")
    .replace(/u\.s\.c\.\s?(?=\d)/g, "u.s.c. s.")
    .replace(/§§?\s*/g, "s.")
    .replace(/\bss\.\s?/g, "s.")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .trim();
}

function isAlphanumeric(char) {
  return /[a-z0-9]/i.test(char);
}

function occursWithBoundary(haystack, needle) {
  if (!needle) return false;
  let searchFrom = 0;
  while (true) {
    const index = haystack.indexOf(needle, searchFrom);
    if (index === -1) return false;
    const before = index > 0 ? haystack[index - 1] : "";
    const after = index + needle.length < haystack.length ? haystack[index + needle.length] : "";
    const beforeIsBoundary = !isAlphanumeric(before);
    const afterIsBoundary = !isAlphanumeric(after) || after === "(";
    if (beforeIsBoundary && afterIsBoundary) return true;
    searchFrom = index + 1;
  }
}

function spanMatchesStatute(span, statute) {
  const normSpan = normalize(span);
  if (!normSpan) return false;
  const candidateFields = [statute.act, statute.act_no, statute.provision, statute.label_en, statute.label_ms];
  for (const field of candidateFields) {
    if (!field) continue;
    if (occursWithBoundary(normalize(field), normSpan)) return true;
  }
  for (const field of [statute.act, statute.label_en]) {
    if (!field) continue;
    if (occursWithBoundary(normSpan, normalize(field))) return true;
  }
  return false;
}

// section: stop list and stemming ------------------------------------------------
// Deliberately small and conservative: this only strips words that would otherwise pollute
// every sentence's term set (function words, pronouns, and the handful of legal filler words
// named in the design brief). Domain words that happen to be common ("client", "party",
// "worker") are left in on purpose, because they are exactly the words that let a genuinely
// on-topic sentence overlap with a statute's excerpt.

const STOP_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "it", "its", "he", "she", "they", "them",
  "his", "her", "their", "you", "your", "i", "we", "our", "us", "who", "whom", "whose", "which",
  "of", "to", "in", "for", "on", "with", "by", "or", "and", "is", "are", "was", "were", "be",
  "been", "being", "as", "at", "from", "not", "no", "if", "then", "than", "so", "but", "also",
  "can", "could", "will", "would", "should", "must", "may", "under", "upon", "within", "between",
  "shall", "such", "any", "section", "act", "law", "person", "provided", "provides", "provision",
  "provisions", "following", "subject", "pursuant", "other", "otherwise", "about", "into", "up",
  "out", "over", "again", "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "both", "more", "most", "some", "same",
  // Defined-term boilerplate that recurs across almost every New York Freelance Isn't Free Act
  // excerpt ("hiring party" is the article's own term for "client") regardless of which specific
  // right or duty the excerpt is actually about. Left in, these two words alone were enough to
  // clear the overlap threshold for any citation from that family attached to any claim at all,
  // which defeats the whole point of this layer.
  "hiring", "party", "parties",
]);

// Longest suffixes checked first so "payment" is not stripped down to a fragment shorter than
// the 4-letter floor before the synonym map (below) has a chance to canonicalise it anyway.
const SUFFIXES = ["ment", "ing", "ion", "ed", "es", "s"];

function stem(word) {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

// section: synonym map ------------------------------------------------
// Hand-written, not derived: these are the plain-English words a model actually uses in a
// 120-word answer for a concept the statute excerpt states in more formal terms. Grouped so
// every member of a group folds to the same canonical term before overlap is counted. Multi-word
// phrases are matched as whole phrases (word-boundary, case-insensitive) before the sentence is
// tokenised, so "small claims court" and "small-claims court" both fold the same way.

const SYNONYM_GROUPS = [
  ["pay", "payment", "paid", "compensation"],
  ["writing", "written", "signed"],
  ["hire", "commissioned", "employee"],
  ["arbitration", "arbitrate", "arbitrator"],
  ["terminate", "termination", "cancel"],
  ["attribution", "credit", "name"],
  ["small claims", "small-claims court"],
  ["retaliation", "blacklist", "penalise", "penalize"],
  ["deadline", "time limit", "years"],
];

const PHRASE_SYNONYMS = []; // { regex, canonical }
const WORD_SYNONYMS = new Map(); // word -> canonical

for (const group of SYNONYM_GROUPS) {
  const canonical = group[0].replace(/[\s-]+/g, "_");
  for (const member of group) {
    if (/[\s-]/.test(member)) {
      const pattern = member.replace(/[-\s]+/g, "[-\\s]+").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      PHRASE_SYNONYMS.push({ regex: new RegExp(`\\b${pattern}\\b`, "gi"), canonical });
    } else {
      WORD_SYNONYMS.set(member, canonical);
    }
  }
}

// section: key term extraction ------------------------------------------------
// Plain word-set overlap only: lowercase, strip stop words, fold synonyms to a canonical token,
// stem what is left. No frequency weighting, no ordering, no embeddings.

function extractKeyTerms(text) {
  const terms = new Set();
  let working = text.toLowerCase();
  for (const { regex, canonical } of PHRASE_SYNONYMS) {
    if (regex.test(working)) terms.add(canonical);
  }
  const words = working.match(/[a-z]+/g) || [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    const canonical = WORD_SYNONYMS.get(word);
    terms.add(canonical || stem(word));
  }
  return terms;
}

function intersectionSize(setA, setB) {
  let count = 0;
  for (const term of setA) {
    if (setB.has(term)) count += 1;
  }
  return count;
}

const statuteTermCache = new Map(); // statute.id -> Set of key terms

function keyTermsForStatute(statute) {
  const cacheKey = statute.id || statute.label_en;
  if (statuteTermCache.has(cacheKey)) return statuteTermCache.get(cacheKey);
  const source = [statute.topic_en, statute.provision, statute.excerpt].filter(Boolean).join(" ");
  const terms = extractKeyTerms(source);
  statuteTermCache.set(cacheKey, terms);
  return terms;
}

// section: sentence splitting ------------------------------------------------
// A citation like "17 U.S.C. § 204(a)" or "N.Y.C. Civ. Ct. Act § 1801" is full of periods that
// are not sentence ends ("U.S.C.", "N.Y.C.", "Civ.", "Ct." are abbreviations, not sentences of
// their own). A hand-written abbreviation list can never cover every citation form the statute
// table or a future jurisdiction adds, so instead every abbreviation actually in play is read
// straight off the data already being trusted: every findLegalReferences span for this answer
// (the baseline's own span detector), plus every dotted word inside the allowed statutes' own
// act/act_no/label_en fields (so "N.Y.C. Civ. Ct. Act", not just the "§ 1801" a span happened to
// capture, is protected even when the detected span itself is shorter than the full citation).
// Every period inside one of those is swapped for a same-length placeholder before sentences are
// split, then restored; a period that is in neither still ends a sentence normally. This is
// still a heuristic, not a parser, and it is allowed to be wrong in the direction of
// under-splitting (one merged "sentence" just gives the grounding check a slightly larger, still
// correct, window to find overlap in).

const PERIOD_PLACEHOLDER = "\u0000";

function abbreviationWordsFor(statutes) {
  const words = new Set();
  for (const statute of statutes) {
    for (const field of [statute.act, statute.act_no, statute.label_en]) {
      if (!field) continue;
      for (const word of field.split(/\s+/)) {
        if (word.includes(".") && /[A-Za-z]/.test(word)) words.add(word);
      }
    }
  }
  return [...words];
}

function maskPeriodsIn(text, literalStrings) {
  let masked = text;
  for (const literal of literalStrings) {
    if (!literal || !literal.includes(".")) continue;
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b only at the start: these all begin with a letter, but several end in a period, where
    // \b would not match anyway.
    const re = new RegExp(`\\b${escaped}`, "g");
    masked = masked.replace(re, (m) => m.replace(/\./g, PERIOD_PLACEHOLDER));
  }
  return masked;
}

function splitSentences(text, spans, statutes) {
  const masked = maskPeriodsIn(text, [...spans, ...abbreviationWordsFor(statutes)]);
  const sentences = [];
  const re = /[^.!?]+(?:[.!?]+(?=\s+[A-Z]|\s*$)|$)/g;
  let match;
  while ((match = re.exec(masked)) !== null) {
    if (match[0].trim().length === 0) continue;
    // Positions come from the masked text but line up exactly with the original: masking only
    // swaps "." for a single placeholder character, so lengths and offsets never move.
    const restored = match[0].replace(new RegExp(PERIOD_PLACEHOLDER, "g"), ".");
    sentences.push({ text: restored, start: match.index, end: match.index + match[0].length });
  }
  if (sentences.length === 0) {
    sentences.push({ text, start: 0, end: text.length });
  }
  return sentences;
}

function countWords(text) {
  const words = text.match(/[A-Za-z]+/g);
  return words ? words.length : 0;
}

// Finds the sentence (or sentence pair) that should ground a given occurrence of span in
// answer. "Occurrence" matters, not just "span": the same citation text can appear more than
// once, attached to different claims, so every occurrence is checked independently rather than
// just the first one.
function contextForOccurrence(answer, spanStart, spanEnd, sentences) {
  const primaryIndex = sentences.findIndex((s) => spanStart >= s.start && spanStart < s.end);
  if (primaryIndex === -1) return null;
  const primary = sentences[primaryIndex];
  // "ends a sentence that introduces it": the citation runs right up to (allowing trailing
  // punctuation/whitespace) the end of its own sentence, so that sentence was only introducing
  // it and the actual claim is in the next one.
  const trailing = primary.text.slice(spanEnd - primary.start).trim();
  const introducesOnly = trailing.length <= 1; // nothing, or a single trailing mark, follows
  let text = primary.text;
  if (introducesOnly && primaryIndex + 1 < sentences.length) {
    text = `${primary.text} ${sentences[primaryIndex + 1].text}`;
  }
  return { text, primaryWordCount: countWords(primary.text) };
}

// section: checking a model answer ------------------------------------------------

export function checkAnswer(answer, allowedStatutes) {
  const baseline = baselineCheckAnswer(answer, allowedStatutes);
  if (!baseline.ok) return baseline;

  const statutes = allowedStatutes || [];
  if (statutes.length === 0 || typeof answer !== "string" || answer.length === 0) {
    return baseline;
  }

  const spans = findLegalReferences(answer);
  const sentences = splitSentences(answer, spans, statutes);
  const misattributed = [];

  for (const span of spans) {
    const matchingStatutes = statutes.filter((statute) => spanMatchesStatute(span, statute));
    if (matchingStatutes.length === 0) continue; // baseline already blocked this; unreachable here

    // Every occurrence of this span in the answer is checked on its own: the baseline
    // de-duplicates spans for its own purpose, but a repeated citation can sit next to a
    // different, unrelated claim each time it appears.
    let searchFrom = 0;
    let anyOccurrenceChecked = false;
    while (true) {
      const spanStart = answer.indexOf(span, searchFrom);
      if (spanStart === -1) break;
      anyOccurrenceChecked = true;
      const spanEnd = spanStart + span.length;
      const context = contextForOccurrence(answer, spanStart, spanEnd, sentences);
      searchFrom = spanStart + 1;
      if (!context) continue;

      const sentenceTerms = extractKeyTerms(context.text);
      const threshold = context.primaryWordCount < 12 ? 1 : 2;

      let bestOverlap = -1;
      let bestStatute = matchingStatutes[0];
      for (const statute of matchingStatutes) {
        const overlap = intersectionSize(sentenceTerms, keyTermsForStatute(statute));
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestStatute = statute;
        }
      }
      if (bestOverlap < threshold) {
        misattributed.push(`misattributed: ${span} -> ${bestStatute.id}`);
      }
    }
    if (!anyOccurrenceChecked) continue;
  }

  const unmatched = [...baseline.unmatched, ...misattributed];
  return { ok: unmatched.length === 0, unmatched };
}
