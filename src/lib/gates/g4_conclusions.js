// src/lib/gates/g4_conclusions.js
//
// What this does: an alternative citation gate (variant G4 of docs/GATE_ALTERNATIVES.md).
// Reference detection and matching are the baseline's, unchanged (findLegalReferences and the
// reference half of checkAnswer, both imported from ../citations.js): this variant only
// replaces the CONCLUSION half with findLegalConclusionsWide, a clause-level detector that
// catches a paraphrased legal conclusion ("a court would likely refuse to enforce this", "you
// could take them to court and win", "the client is legally obliged to pay within 30 days")
// that the baseline's fixed phrase list ("is void", "under ... law", "you have a right") does
// not. It also fixes the baseline's own false-block case: "ask a lawyer whether this is
// enforceable" trips the baseline's bare "is enforceable" pattern even though the sentence
// asks a question and answers nothing, so this variant suppresses a conclusion (baseline or
// wide) when it sits inside an open-question frame's own clause, where a clause ends at a
// semicolon, colon, ", but", ", and", a sentence boundary, or a following independent
// assertion. Suppression is scoped to that one clause on purpose, never the whole sentence:
// "Ask a lawyer whether a court would enforce this, but this is unenforceable anyway" hedges
// its FIRST clause only; the second clause, after ", but", asserts a conclusion outright and
// must still block. Rework 2026-09-26 after the coordinator measured 4 leaks caused by the
// earlier sentence-wide suppression (see the test file for the exact cases).
// What it must never do: rewrite the answer (pass or block only, same as every gate variant),
// call a model or use embeddings/similarity search, treat a hedge word alone ("may", "might",
// "could", "likely") as making a conclusion safe, or let a hedge phrase suppress a conclusion
// sitting in a DIFFERENT clause of the same sentence. "A court would likely refuse to enforce
// this" is still a conclusion: "likely" softens confidence, not the fact that a legal outcome
// is being asserted. Only a genuine open-question frame in that same clause suppresses, and
// "whether or not"/"whether you like it or not" are idioms meaning "regardless", never an
// open question, so they never count as one; "check with" only counts when it names a lawyer,
// attorney or solicitor, not any other professional ("check with your accountant" is not a
// hedge at all).
// Hard requirement served: R2 (no unsourced legal conclusion reaches the user; see
// ../citations.js's own header for why this blocks rather than flags).
// Developed by Lutfitek.

import { findLegalConclusions, checkAnswer as baselineCheckAnswer } from "../citations.js";

export const id = "g4_conclusions";
export const description =
  "Clause-level legal-conclusion detector: a legal predicate plus an assertion frame blocks, " +
  "unless that same clause carries an open-question frame that refers the reader to a lawyer " +
  "instead of asserting an outcome.";

// section: splitting into sentences, then clauses ------------------------------------------
// Two passes, deliberately simple rather than a real parser:
//
// 1. Sentences: split after a ".", "!" or "?" followed by whitespace, and on any run of
//    newlines. Not a full tokenizer (it will occasionally split mid-abbreviation, e.g.
//    "U.S.C."), but the cost of a wrong split here is at most a slightly different span
//    checked for the same patterns, never a missed or invented finding.
// 2. Clauses within a sentence: split at ";", ":", ", but" or ", and". These are the
//    boundaries a hedge's own open-question span stops at (see the header comment and the
//    2026-09-26 rework note): a hedge in one clause must never suppress a bare assertion sitting
//    in a LATER clause of the same sentence ("Ask a lawyer whether a court would enforce this,
//    but this is unenforceable anyway" hedges only its first clause). A bare comma with no
//    "but"/"and" following is NOT treated as a clause boundary here: it is common inside a
//    single assertion ("New York, like most states, protects freelancers from this") and
//    splitting on it would only fragment one clause into pieces that each fail the
//    predicate+assertion check on their own, weakening the detector rather than sharpening it.
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function splitClauses(sentence) {
  return sentence
    .split(/;|:|,\s*(?:but|and)\b/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

// section: the open-question frame (suppresses a conclusion in that clause only) ----------
// A hedge WORD alone ("may", "might", "could", "likely") is not on this list on purpose: it
// only softens confidence, it does not hand the question to a lawyer. Only a frame that
// explicitly leaves the outcome open, or explicitly refers it out, suppresses.
//
// "whether" is handled separately below rather than as a plain pattern, because "whether or
// not" and "whether you like it or not" are idioms meaning "regardless of that", not an open
// legal question, so they must never count as one even though the bare word "whether" is
// present.
const WHETHER_RE = /\bwhether\b/i;
const WHETHER_OR_NOT_IDIOM_RE = /\bwhether\s+(?:or\s+not\b|you\s+like\s+it\s+or\s+not\b)/i;

const OPEN_QUESTION_PATTERNS = [
  /\bask\s+a\s+lawyer\b/i,
  /\ba\s+lawyer\s+can\s+tell\s+you\b/i,
  /\bmay\s+or\s+may\s+not\b/i,
  /\bit\s+depends\b/i,
  // "check with" only counts when it names a lawyer, attorney or solicitor: "check with your
  // accountant" refers the reader to tax advice, not a legal open question, so it must not
  // suppress a legal conclusion sitting in the rest of that clause.
  /\bcheck\s+with\s+(?:a\s+|an\s+|your\s+)?(?:lawyer|attorney|solicitor)\b/i,
  /\bconsult\s+a\s+lawyer\b/i,
  /\bspeak\s+(?:to|with)\s+a\s+lawyer\b/i,
];

function isOpenQuestion(clause) {
  if (WHETHER_RE.test(clause) && !WHETHER_OR_NOT_IDIOM_RE.test(clause)) return true;
  return OPEN_QUESTION_PATTERNS.some((pattern) => pattern.test(clause));
}

// section: legal predicates ------------------------------------------------
// Each one names a legal consequence or verdict, not merely a legal-flavoured word: "a law
// firm" or "legal advice" contain no predicate here, so they never reach the assertion check
// at all and cannot block on their own. Order matters only for which matched text is reported
// as the span; it does not change whether the sentence blocks.
//
// A few predicates ("protect(s)", and by the same reasoning "liable"/"liability") are words a
// contract answer legitimately uses to describe what the CONTRACT requires of its own parties
// ("you must protect the client", "your liability could be unlimited"), not what the law does.
// Those only count as a legal conclusion when their subject is the law itself or a lawmaker,
// never a contract party. LEGAL_SUBJECT names that subject; LEGAL_PROTECTS_RE below is the one
// predicate that currently needs it written out as its own pattern (protects/protect were
// already over-broad; liable/liability for are narrow enough on their own not to need it, see
// the comment at those two patterns).
const LEGAL_SUBJECT =
  "(?:the\\s+law|federal\\s+law|state\\s+law|new\\s+york\\s+law|new\\s+york|the\\s+state|" +
  "the\\s+statute|the\\s+act|the\\s+courts?)";
const LEGAL_PROTECTS_RE = new RegExp(
  `\\b${LEGAL_SUBJECT}\\b[^.!?;:]{0,20}\\bprotects?\\b[^.!?;:]{0,20}\\b(?:you|freelancers?|contractors?|workers?)\\b`,
  "i"
);

const PREDICATE_PATTERNS = [
  /\b(?:un)?enforceable\b/i,
  /\benforce\b/i,
  /\bvoid\b/i,
  /\binvalid\b/i,
  /\bvalid\b/i,
  /\billegal\b/i,
  /\bunlawful\b/i,
  /\bagainst\s+the\s+law\b/i,
  // "liable" ("they would be liable") is one of the paraphrased conclusions this variant is
  // meant to catch, so it stays broad, unscoped by subject. It does not need the same
  // legal-subject guard as protects/protect above: the word "liability" on its own (as in "your
  // liability could be unlimited", describing what the CONTRACT exposes a party to, not a legal
  // verdict) is simply a different word from "liable" and from "liability for" and matches
  // neither pattern, so that ordinary contract-drafting sentence never reaches this predicate at
  // all. Add a test locking that in rather than narrowing the patterns further.
  /\bliable\b/i,
  /\bliability\s+for\b/i,
  /\bentitled\s+to\b/i,
  /\blegally\s+(?:obliged|required|bound|binding)\b/i,
  /\bsue\b/i,
  /\btake\b[^.!?]{0,25}\bto\s+court\b/i,
  /\bwin\b[^.!?]{0,20}\bcourt\b/i,
  /\bhold\s+up\b(?:\s+in\s+court)?/i,
  /\bprotected\s+by\s+(?:the\s+)?law\b/i,
  /\bthe\s+law\s+(?:requires|says|protects)\b/i,
  // "protects/protect you|freelancers|contractors|workers" is a legal conclusion only when
  // its SUBJECT is the law or a lawmaker (see LEGAL_SUBJECT below): "the client must protect
  // you" or "you must protect the client" describes what the CONTRACT requires, not what the
  // law does, and must never block on this predicate alone (2026-09-26, found on a real model
  // answer: "you must protect the client, but the client doesn't agree to protect you" was
  // falsely blocked before this subject check existed). LEGAL_PROTECTS_RE below requires that
  // subject to appear before the verb, in the same clause.
  LEGAL_PROTECTS_RE,
  /\bcourt\s+(?:would|will)\b/i,
  /\ba\s+judge\s+would\b/i,
  /\bstatutory\s+rights?\b/i,
  /\blegal\s+effect\b/i,
  // A bare adverbial "legally," at a clause boundary ("legally, they cannot do this") is
  // itself a legal-conclusion marker distinct from "legally obliged/required/bound/binding"
  // above (that phrase form is covered separately so both report a readable span).
  /\blegally\s*,/i,
];

function matchFirstPredicate(sentence) {
  for (const pattern of PREDICATE_PATTERNS) {
    const match = sentence.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// section: the assertion frame ------------------------------------------------
// A predicate alone is not a conclusion: "legal effect" can appear inside a question or a
// hedge. What turns it into one is a subject asserting it as present fact rather than asking
// about it or leaving it open: "this is", "you are", "they would be", "a court would",
// "New York protects", "the client is", "that's", "you could win". Rather than enumerate every
// possible subject (any noun phrase, any jurisdiction name, any pronoun), this checks for the
// FINITE VERB half of that frame, including its contracted spellings ("that's", "you're",
// "I'm"). "may"/"might"/"could"/"likely" are hedge WORDS (per the header comment, a hedge word
// alone never makes a conclusion safe), but "could"/"may"/"might" still count as an assertion
// verb here, exactly because they do not make it safe: "you could take them to court and win"
// is as much a conclusion as "you would win" is, just phrased a shade less certainly. Only the
// OPEN_QUESTION_PATTERNS frame above (not a bare modal) suppresses. Known limit: this can
// occasionally fire on a declarative sentence that happens to share a predicate word with an
// unrelated ordinary fact and one of these verbs; over-blocking is the same safe-direction
// trade-off the baseline gate documents in ../citations.js (a wrongly blocked harmless answer
// costs less than a wrongly shown conclusion), so this is accepted rather than narrowed further.
const ASSERTION_RE =
  /\b(?:is|are|was|were|would\s+be|will\s+be|could\s+be|would|will|can|cannot|can't|could|may|might|has|have|protects?|requires?|entitles?|allows?|prohibits?|bars?|obliges?|binds?|guarantees?)\b|'s\b|'re\b|'m\b/i;

// section: the wide detector ------------------------------------------------

export function findLegalConclusionsWide(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const found = new Map(); // lowercase key -> original-case span, de-duplicated like citations.js

  for (const sentence of splitSentences(text)) {
    for (const clause of splitClauses(sentence)) {
      // The open-question frame suppresses BOTH the baseline patterns and the wide check for
      // this clause only: a hedge in one clause must never launder a bare assertion made in a
      // later clause of the same sentence, so suppression never crosses a clause boundary
      // (";" / ":" / ", but" / ", and" / a sentence boundary; see splitClauses above).
      if (isOpenQuestion(clause)) continue;

      // Union: the baseline's own fixed-phrase patterns still fire here (this variant is a
      // superset of the baseline, not a replacement for it), but now scoped to one clause at a
      // time, which is what lets the open-question check above suppress a baseline hit that
      // sits in a hedge's own clause ("ask a lawyer whether this is enforceable") while still
      // blocking the same phrase when it is actually asserted in a later clause ("... but this
      // is unenforceable anyway").
      for (const span of findLegalConclusions(clause)) {
        const key = span.toLowerCase();
        if (!found.has(key)) found.set(key, span);
      }

      // Wide: a legal predicate together with an assertion frame, anywhere in the clause.
      const predicateSpan = matchFirstPredicate(clause);
      if (predicateSpan && ASSERTION_RE.test(clause)) {
        const key = predicateSpan.toLowerCase();
        if (!found.has(key)) found.set(key, predicateSpan);
      }
    }
  }

  return [...found.values()];
}

// section: checkAnswer ------------------------------------------------
// Reuses the baseline's reference detection and matching completely unchanged: this calls the
// real ../citations.js checkAnswer to get the reference half of the decision (unmatchedRefs),
// then discards only its conclusion half (every entry it prefixed "conclusion: ") and replaces
// it with this file's wider detector. Nothing about how a reference is found or matched against
// allowedStatutes is reimplemented here.

export function checkAnswer(answer, allowedStatutes) {
  const baseline = baselineCheckAnswer(answer, allowedStatutes);
  const unmatchedRefs = baseline.unmatched.filter((span) => !span.startsWith("conclusion: "));
  const unmatchedConclusions = findLegalConclusionsWide(answer).map((span) => `conclusion: ${span}`);
  const unmatched = [...unmatchedRefs, ...unmatchedConclusions];
  return { ok: unmatched.length === 0, unmatched };
}
