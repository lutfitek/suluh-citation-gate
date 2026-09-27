// src/lib/gates/g2_alias.js
//
// What this does: an alternative citation gate (variant G2, "alias index"). Instead of the
// baseline's substring-tolerant comparison (src/lib/citations.js), this builds, once per
// statute, the full set of surface forms a person could reasonably write for that statute's
// title and section (from its structured fields: act, act_no, provision, label_en, label_ms),
// normalises everything through one canonical folding step, and then requires an EXACT set
// membership match. A reviewer can print aliasesFor(statute) and read every form the gate
// will accept for that statute, which the baseline's substring logic does not offer.
// What it must never do: attribute a bare section number (e.g. "§ 2") to a statute when the
// text also names a different allowed statute's title in the same sentence (see "bare-form
// attribution" below); rewrite, correct or return a modified answer; fetch, embed or call a
// model. Detection of reference-shaped spans and of unsourced legal conclusions is reused
// verbatim from citations.js, because this variant only replaces the ATTRIBUTION step, not
// the "does this look like a legal reference at all" step.
// Hard requirement served: R2 (no legal reference reaches the user unless it comes from the
// verified statute table).
// Developed by Lutfitek.

import { findLegalReferences, findLegalConclusions } from "../citations.js";

export const id = "g2_alias";
export const description =
  "Exact-match gate: generates every alias of each allowed statute's title and section, folds " +
  "spans and aliases through one normaliser, and blocks any span that is not an exact member " +
  "of the allowed alias set.";

// section: known common names ------------------------------------------------------------
// A handful of statutes are known in practice by a name that cannot be derived from their own
// structured fields at all: "Freelance Isn't Free Act" is the popular name for the whole New
// York freelance article of the General Business Law (§§ 1410-1414), and "FAA" is the standard
// abbreviation for the Federal Arbitration Act. Both are baked into this seed's own citable
// statutes (see seed/statutes.json), so the mapping is accurate for the data this gate is
// actually run against; it is not a generic legal-name resolver and is not meant to be one.
// Keyed on the act-name text as it appears (or appears inside parentheses) in a statute's
// "act" field, so it applies uniformly to any statute carrying that act name.
const ACT_ABBREVIATIONS = {
  "New York General Business Law": [
    "GBL",
    "Gen. Bus. Law",
    "General Business Law",
    "Freelance Isn't Free Act",
  ],
  "New York Civil Practice Law and Rules": ["CPLR", "C.P.L.R."],
  "New York City Civil Court Act": ["NYC Civil Court Act", "N.Y.C. Civil Court Act"],
  "Federal Arbitration Act": ["FAA"],
};

// section: canonical normaliser ------------------------------------------------------------
// Every alias and every detected span is folded through this ONE function before comparison.
// It only smooths trivial formatting noise (Unicode form, case, spacing around "§", spacing
// inside "U.S.C.", and punctuation); it deliberately does NOT try to unify "§" with "section"
// or "s." with each other, because every one of those marker variants is already generated as
// its own explicit alias below (see buildAliasData). Folding markers together as well would
// only widen the exact-match set for no benefit and make the alias list harder for a reviewer
// to read literally.

function normalizeAlias(text) {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFKC")
    .toLowerCase()
    // "§201(b)" and "§ 201(b)" must fold the same way; insert one canonical space after §.
    .replace(/§\s*/g, "§ ")
    // "U.S.C.", "USC", "U.S.C.A." all fold to "usc" (a title number stays outside). No "\s*"
    // is allowed between or after the letters: an earlier version used "\s*" right before the
    // trailing "\b", which let the regex greedily swallow the space that follows "U.S.C." in
    // ordinary prose (e.g. "9 U.S.C. governs" collapsed to "9 uscgoverns"), silently merging
    // the abbreviation into the next word and quietly breaking the same-sentence check in
    // checkAnswer below (it uses this normaliser on whole sentences, not just short aliases).
    .replace(/\bu\.?s\.?c\.?(?:a\.?)?\b/g, "usc")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// section: boundary-aware substring check ---------------------------------------------------
// Used only for the bare-form disambiguation step below (checking whether a DIFFERENT
// statute's title is named in the same sentence). Everywhere else this gate does exact set
// membership, not substring containment, which is the whole point of the alias index.

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
    if (!isAlphanumeric(before) && !isAlphanumeric(after)) return true;
    searchFrom = index + 1;
  }
}

// section: pulling structured pieces out of a statute row ------------------------------------

// "Copyright Act (17 U.S.C.)" -> ["Copyright Act (17 U.S.C.)", "Copyright Act", "17 U.S.C."].
// Statutes whose "act" field has no parenthetical (all the New York ones) just get the one form.
function actNameVariants(act) {
  const variants = [];
  if (!act) return variants;
  variants.push(act);
  const parenMatch = act.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    variants.push(parenMatch[1].trim());
    variants.push(parenMatch[2].trim());
  }
  return variants;
}

// Pulls the section number (with any lettered subsection, e.g. "201(b)", "106A(a)", "1411")
// out of a provision or label. Deliberately anchored on "§" only: provision fields sometimes
// carry a trailing plain-English explanation in parentheses ("§ 101 (definition of ...)")
// that is separated from the number by a space, so it is never mistaken for a subsection
// (the subsection group below requires the parenthesis to sit directly against the digits).
function extractSection(text) {
  if (!text) return null;
  const match = text.match(/§\s?(\d+[A-Za-z]?(?:\([A-Za-z0-9]+\))*)/);
  return match ? match[1] : null;
}

// section: building the alias set for one statute --------------------------------------------
// Generates, from the statute's own fields only (plus the small named-common-name map above),
// every reasonably-shaped surface form: the raw fields; the act name with and without its
// parenthetical short form; each of those "the <name>" form; known abbreviations; the section
// number with and without its subsection; and every combination of an identity form (act name,
// short form, abbreviation, or act_no) with a section form ("<identity> § <sec>",
// "<identity> section <sec>", "<identity> <sec>" with no marker at all, "section <sec> of the
// <identity>", and, where act_no reads like "<N> U.S.C.", "title <N> section <sec>" /
// "title <N> § <sec>"). A bare section alone ("§ 1411", "section 1411", "s. 1411") is also
// generated and added to the alias list (a reviewer should see it), but tracked separately as
// a "bare form": see the attribution decision in checkAnswer below for why it needs one.

function buildAliasData(statute) {
  const aliases = new Set();
  const bareNormalized = new Set();
  const identityFormsRaw = new Set();

  const add = (value) => {
    if (value && String(value).trim()) aliases.add(String(value).trim());
  };

  add(statute.act);
  add(statute.act_no);
  add(statute.label_en);
  add(statute.label_ms);

  if (statute.act_no) identityFormsRaw.add(statute.act_no);

  const actNames = actNameVariants(statute.act);
  for (const name of actNames) {
    identityFormsRaw.add(name);
    add(name);
    add(`the ${name}`);
    for (const abbreviation of ACT_ABBREVIATIONS[name] || []) {
      identityFormsRaw.add(abbreviation);
      add(abbreviation);
      add(`the ${abbreviation}`);
    }
  }

  const section = extractSection(statute.provision) || extractSection(statute.label_en);
  const sectionForms = new Set();
  if (section) {
    sectionForms.add(section);
    const withoutSubsection = section.replace(/\([A-Za-z0-9]+\)$/, "");
    if (withoutSubsection !== section) sectionForms.add(withoutSubsection);
  }

  const titleMatch = (statute.act_no || "").match(/^(\d+)\s*U\.?\s?S\.?\s?C\.?/i);
  const titleNo = titleMatch ? titleMatch[1] : null;

  // Bare section forms go on the DISPLAY list (aliases, below) so a reviewer sees them, but
  // they are deliberately kept OUT of normalizedAll: normalizedAll is the unconditional,
  // no-questions-asked match set, and a bare section number is never unconditional (see the
  // attribution decision in checkAnswer). They live only in normalizedBare, which checkAnswer
  // consults separately and only after applying the same-sentence disambiguation guard.
  const bareDisplayForms = new Set();
  for (const sec of sectionForms) {
    bareDisplayForms.add(`§ ${sec}`);
    bareDisplayForms.add(`section ${sec}`);
    bareDisplayForms.add(`s. ${sec}`);
    bareNormalized.add(normalizeAlias(`§ ${sec}`));
    bareNormalized.add(normalizeAlias(`section ${sec}`));
    bareNormalized.add(normalizeAlias(`s. ${sec}`));

    for (const identity of identityFormsRaw) {
      add(`${identity} § ${sec}`);
      add(`${identity} section ${sec}`);
      add(`${identity} s. ${sec}`);
      add(`${identity} ${sec}`);
      add(`section ${sec} of the ${identity}`);
      add(`section ${sec} of ${identity}`);
    }
    if (titleNo) {
      add(`title ${titleNo} section ${sec}`);
      add(`title ${titleNo} § ${sec}`);
    }
  }

  // normalizedAll (the unconditional match set) is built from the identity-attached aliases
  // only. The display list handed back by aliasesFor additionally includes the bare forms, so
  // a reviewer can see them, but they are unioned in afterwards, never before, this Set is made.
  const normalizedAll = new Set([...aliases].map(normalizeAlias));
  for (const bare of bareDisplayForms) aliases.add(bare);

  return {
    aliases: [...aliases],
    normalizedAll,
    normalizedBare: bareNormalized,
    identityForms: new Set([...identityFormsRaw].map(normalizeAlias)),
  };
}

// Cached per statute object, as the design calls for: the same statute row is looked at for
// every answer checked against a clause type that cites it, and the alias set never changes
// for a given row within a process, so there is no reason to rebuild it each time.
const aliasCache = new WeakMap();

function getAliasData(statute) {
  let data = aliasCache.get(statute);
  if (!data) {
    data = buildAliasData(statute);
    aliasCache.set(statute, data);
  }
  return data;
}

// Exported so a reviewer can audit exactly what this gate will accept for a given statute,
// without having to read the generation code to reconstruct it.
export function aliasesFor(statute) {
  return getAliasData(statute).aliases.slice().sort();
}

// section: splitting the answer into sentences ------------------------------------------------
// Only needed for the bare-form attribution decision below. This never has to be a
// linguistically perfect sentence boundary, only a "how far away is the nearest full stop"
// boundary for deciding whether a second statute's title was named in the same breath as a
// bare section number. It must NOT split on every "." though: legal text is full of periods
// that are not sentence ends ("U.S.C.", "N.Y.", "Gen. Bus. Law", "s."), and citations are
// exactly where those live. A period, "!" or "?" only counts as a sentence end when it is
// followed by whitespace and then either the end of the text or a capital letter, digit, quote
// or opening bracket (an ordinary abbreviation is followed by whitespace and a lower-case
// word, or by no whitespace at all, e.g. "U.S.C." running straight into the next letter).
//
// One more guard is needed beyond that: a multi-word abbreviated Act name where EVERY word is
// itself abbreviated with a period ("N.Y.C. Civ. Ct. Act") has each of its internal periods
// followed by whitespace and then ANOTHER capitalised word ("Civ.", "Ct.", "Act"), which looks
// exactly like a sentence boundary by the rule above. So: if the token right before the
// punctuation is short (5 characters or fewer) and starts with a capital letter, treat it as
// still-abbreviating rather than sentence-ending, regardless of what follows. A real sentence
// essentially never ends on a 1-to-5-character capitalised word immediately before a full
// stop; a run of abbreviated Act-name words does exactly that, repeatedly.
function endsOnShortCapitalisedToken(text, punctuationStart) {
  let tokenStart = punctuationStart;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) tokenStart--;
  const token = text.slice(tokenStart, punctuationStart);
  return token.length > 0 && token.length <= 5 && /^[A-Z]/.test(token);
}

function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let isBoundary = false;
    let boundaryEnd = i + 1;
    if (ch === "\n") {
      isBoundary = true;
    } else if (ch === "." || ch === "!" || ch === "?") {
      let j = i;
      while (j + 1 < text.length && /[.!?]/.test(text[j + 1])) j++;
      boundaryEnd = j + 1;
      if (!endsOnShortCapitalisedToken(text, i)) {
        const rest = text.slice(boundaryEnd);
        const whitespaceMatch = rest.match(/^\s+/);
        if (rest === "") {
          isBoundary = true;
        } else if (whitespaceMatch) {
          const nextChar = rest.slice(whitespaceMatch[0].length)[0];
          isBoundary = nextChar === undefined || /[A-Z0-9"'(]/.test(nextChar);
        }
      }
      i = j;
    }
    if (isBoundary) {
      sentences.push({ text: text.slice(start, boundaryEnd), start, end: boundaryEnd });
      start = boundaryEnd;
    }
  }
  if (start < text.length) sentences.push({ text: text.slice(start), start, end: text.length });
  return sentences;
}

// Every literal occurrence of `span` inside `text`, as character ranges. Needed twice below:
// to decide whether a bare span sits inside an already-resolved longer span, and to check the
// bare-form guard at EVERY place the span occurs, not just the first (a span repeated later in
// the same answer can land in a sentence with different neighbours than its first occurrence).
function findOccurrences(text, span) {
  const occurrences = [];
  if (!span) return occurrences;
  let from = 0;
  while (true) {
    const index = text.indexOf(span, from);
    if (index === -1) return occurrences;
    occurrences.push({ start: index, end: index + span.length });
    from = index + 1;
  }
}

// section: checking a model answer against the allowed statutes -------------------------------
//
// Bare-form attribution decision (deliberate, documented per the brief): the baseline's own
// regexes sometimes yield a citation split across two spans, e.g. "section 201(b) of the
// Copyright Act" is found as "section 201(b)" (a bare section, no title attached) plus
// "Copyright Act" (a title, no section attached) as two separate spans, because the Act-name
// pattern and the section pattern in citations.js run independently. A bare section span can
// never be an exact member of any statute's full alias set on its own merit (those all require
// an identity form attached) unless the gate below treats it specially. Two sub-cases:
//
// (A) Containment: sometimes the bare span is not really a separate fragment at all, but a
// literal substring of a LONGER span that already resolved on its own merits, e.g. "9 U.S.C.
// § 2" (title+section combined in one baseline regex match) already directly matches an
// allowed statute's alias, and "§ 2" alone is also independently detected by the separate "§"
// pattern at the exact same position. That "§ 2" needs no guard at all: it was never an
// unattached fragment, it is the same citation already accounted for. This is checked per
// OCCURRENCE (via findOccurrences), because a span's later repeat in the answer might not sit
// inside any resolved span even if an earlier occurrence did.
//
// (B) Genuinely bare occurrences (not contained in any resolved span) are allowed only when
// (a) exactly one allowed statute in this clause type's citable list has generated that bare
// form (so the number alone is unambiguous within THIS answer's context), AND (b) no OTHER
// allowed statute's title is named in the same sentence as that occurrence, where "other"
// means a title distinct from the claimant statute's own title: two allowed statutes can
// share the same Act (e.g. 9 U.S.C. §2 and 9 U.S.C. §3 are both the Federal Arbitration Act),
// and naming that shared title is not a conflict, only naming a genuinely different one is
// (so "17 U.S.C. § 2" misquoted elsewhere as bare "§ 2" cannot borrow the Federal Arbitration
// Act's "§ 2" just because both use that number, when the sentence names a different title).
// Both conditions must hold for every occurrence not covered by (A); any failing occurrence
// blocks the whole span, which is the safe direction to be wrong in.

export function checkAnswer(answer, allowedStatutes) {
  const statutes = allowedStatutes || [];
  const text = typeof answer === "string" ? answer : "";
  const spans = findLegalReferences(text);
  const sentences = splitSentences(text);
  const perStatute = statutes.map((statute) => ({ statute, data: getAliasData(statute) }));

  // Pass 1: resolve every span that is a direct, unconditional alias match on its own, and
  // remember where each one occurs. This has to happen before pass 2, because a bare span's
  // containment check (A above) depends on knowing every resolved span's occurrences, and span
  // order in `spans` is not guaranteed to put a longer span before a shorter one it contains.
  const unresolved = [];
  const resolvedRanges = [];
  for (const span of spans) {
    const normSpan = normalizeAlias(span);
    if (!normSpan) continue;
    const directHit = perStatute.some(({ data }) => data.normalizedAll.has(normSpan));
    if (directHit) {
      resolvedRanges.push(...findOccurrences(text, span));
    } else {
      unresolved.push({ span, normSpan });
    }
  }

  const unmatchedRefs = [];

  for (const { span, normSpan } of unresolved) {
    const claimants = perStatute.filter(({ data }) => data.normalizedBare.has(normSpan));
    if (claimants.length !== 1) {
      unmatchedRefs.push(span);
      continue;
    }

    const owner = claimants[0].statute;
    const ownerIdentity = getAliasData(owner).identityForms;
    const occurrences = findOccurrences(text, span);

    const blocked = occurrences.some((occ) => {
      // (A) This occurrence is just a substring of an already-resolved longer citation:
      // nothing further to check for it.
      const contained = resolvedRanges.some((r) => occ.start >= r.start && occ.end <= r.end);
      if (contained) return false;

      // (B) Genuinely bare: guard against a DIFFERENT allowed statute's title in this sentence.
      const sentence =
        (sentences.find((s) => occ.start >= s.start && occ.start < s.end) || { text }).text;
      const normSentence = normalizeAlias(sentence);
      return perStatute.some(({ statute, data }) => {
        if (statute === owner) return false;
        for (const identity of data.identityForms) {
          if (!identity || ownerIdentity.has(identity)) continue; // shared title, not a conflict
          if (occursWithBoundary(normSentence, identity)) return true;
        }
        return false;
      });
    });

    if (blocked) unmatchedRefs.push(span);
  }

  // Legal conclusions carry no reference to attribute at all, so this variant does not touch
  // that step: they are reused verbatim from citations.js and always block, exactly as the
  // baseline does, prefixed the same way so the decision trace reads consistently between
  // gate implementations.
  const unmatchedConclusions = findLegalConclusions(text).map((span) => `conclusion: ${span}`);

  const unmatched = [...unmatchedRefs, ...unmatchedConclusions];
  return { ok: unmatched.length === 0, unmatched };
}
