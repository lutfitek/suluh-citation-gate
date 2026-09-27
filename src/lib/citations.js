// src/lib/citations.js
//
// What this does: finds every legal-reference-looking span in a piece of text
// (findLegalReferences), and checks whether every span found in a model's answer is
// attributable to one of the clause type's CITABLE statutes (checkAnswer).
// What it must never do: let an unmatched span pass as "flagged but shown". Any span that
// cannot be attributed to an allowed statute means the whole answer is BLOCKED, not merely
// flagged: a flag competes for the reader's attention against everything else on the page and
// can be missed; a block cannot be missed, because nothing risky is shown at all.
// Hard requirement served: R2 (no legal reference reaches the user unless it comes from the
// verified statute table).
// Developed by Lutfitek.

// section: reference patterns ------------------------------------------------
// Each pattern is deliberately loose (over-matching is safe here: an over-matched span that
// turns out to be fine just fails to find a statute to attribute to and gets blocked, which is
// the safe direction to be wrong in; under-matching would let a real reference slip through).

const PATTERNS = [
  // "s.26(2)", "s 26", "ss.5", "section 74", "seksyen 10"
  /\b(?:sections?|seksyen|ss?\.)\s?\d+[A-Za-z]?(?:\(\d+\))*/gi,
  // "Act 332", "Akta 136"
  /\b(?:Act|Akta)\s+\d+[A-Za-z]?\b/g,
  // "Copyright Act 1987", "Contracts Act 1950" (one or more capitalised words then Act + year)
  /\b(?:[A-Z][a-zA-Z]*\s+){1,6}Act\s+\d{4}\b/g,
  // "Akta Hak Cipta 1987" (Akta then one or more words then a year)
  /\bAkta(?:\s+[A-Za-z]+){0,6}\s+\d{4}\b/g,
  // "Akta Kontrak", "Akta Hak Cipta" (Akta then 1-4 capitalised words, no year required, e.g.
  // an Act named without stating its year). Over-matching here is the safe direction, same
  // rationale as findActNameSpans below: it just costs a harmless answer a block.
  /\bAkta(?:\s+[A-Z][a-zA-Z]*){1,4}\b/g,
  // section: US forms (added for the US branch, 2026-09-26) ----------------------------------
  // "§ 204(a)", "§§ 201-204", "§1411"
  /§§?\s?\d+[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?(?:\([A-Za-z0-9]+\))*/g,
  // "17 U.S.C. § 204(a)", "17 USC 204", "U.S.C.A." (title number and section optional)
  /\b(?:\d+\s?)?U\.?\s?S\.?\s?C\.?(?:\s?A\.?)?(?:\s?§*\s?\d+[A-Za-z]?(?:\([A-Za-z0-9]+\))*)?/g,
  // "29 C.F.R. 541", "CFR"
  /\b(?:\d+\s?)?C\.?\s?F\.?\s?R\.?(?:\s?§*\s?[\d.]+)?/g,
  // New York shorthand: "CPLR 213", "C.P.L.R. § 213", "GBL 1411", "Gen. Bus. Law § 1411"
  /\bC\.?\s?P\.?\s?L\.?\s?R\.?(?:\s?§*\s?\d+[A-Za-z]?(?:\(\d+\))*)?/g,
  /\b(?:GBL|Gen\.?\s+Bus\.?\s+Law|General\s+Business\s+Law)(?:\s?§*\s?\d+[A-Za-z]?(?:\(\d+\))*)?/gi,
  // Uniform Commercial Code: "UCC 2-207", "U.C.C. § 2-718", "Uniform Commercial Code"
  /\bU\.?\s?C\.?\s?C\.?(?:\s?§*\s?\d+-\d+)?/g,
  /\bUniform\s+Commercial\s+Code\b/gi,
  // Any named code: "Civil Code", "Labor Code", "Business and Professions Code",
  // "Administrative Code". Over-matches the odd "Dress Code"; that only blocks a harmless answer.
  /\b(?:[A-Z][a-zA-Z]*\s+(?:and\s+)?){1,4}Code\b/g,
  // Session laws and secondary authorities: "Pub. L. 94-553", "Public Law 117-90", "Restatement"
  /\bPub(?:lic)?\.?\s+L(?:aw)?\.?\s+\d+[-–]\d+/gi,
  /\bRestatement\b/g,
  // Constitutional amendments named by ordinal ("First Amendment"); a lower-case "amendment to
  // this agreement" is ordinary contract language and is not matched.
  /\b(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Fourteenth|Fifteenth)\s+Amendment\b/g,
  /\bU\.?S\.?\s+Constitution\b|\bConstitution\s+of\s+the\s+United\s+States\b/gi,
  // "Order 29", "O.93"
  /\b(?:Order|O\.)\s?\d+[A-Za-z]?\b/g,
  /\bRules of Court\b/gi,
  /\bFederal Constitution\b/gi,
  // "Article 5"
  /\bArticle\s+\d+\b/g,
  // case-style "X v Y" / "X v. Y" (a short run of capitalised words either side of "v"/"v.")
  /\b[A-Z][A-Za-z.&'-]*(?:\s+[A-Z][A-Za-z.&'-]*){0,4}\s+v\.?\s+[A-Z][A-Za-z.&'-]*(?:\s+[A-Z][A-Za-z.&'-]*){0,4}\b/g,
];

// section: Act names with no year (English) ------------------------------------------------
// A model can name a real Act while dropping the year entirely ("the Contracts Act", "the
// Employment Act"), which none of the patterns above catch (they all anchor on a year or a
// number). This one matches one to six capitalised words immediately followed by "Act", with
// no year required. It is deliberately broad: over-matching just blocks a harmless answer,
// which is the safe direction to be wrong in (the opposite mistake lets an invented Act name
// through). The one guard needed is against a false start: a sentence-initial capitalised
// word that is not really part of an Act name ("The Act is void" with nothing else naming it,
// or "This Act...") is rejected by checking the word immediately before "Act" against a small
// stop list, so a bare "The"/"This"/"That"/"An"/"A" there means no real name was given.
// ("Act" used as a verb at a sentence's own start, e.g. "Act quickly...", is excluded for a
// simpler reason: nothing capitalised precedes it, so the regex has nothing to match at all.)
// The trailing (?!\s*\d) also matters: without it, any capitalised word right before a real
// "Act <number>"/"Act <year>" citation (e.g. the sentence-initial "See" in "See Act 332 for
// details.") gets swept up into a bogus "See Act" span alongside the genuine "Act 332" span
// that the other patterns already caught correctly; skipping the no-year form whenever a
// number actually follows leaves that case to the patterns that are built for it.
const ACT_STOP_WORDS = new Set(["the", "this", "that", "an", "a"]);
const ACT_NAME_NO_YEAR_RE = /\b((?:[A-Z][a-zA-Z]*\s+){1,6})Act\b(?!\s*\d)/g;

function findActNameSpans(text) {
  const spans = [];
  for (const match of text.matchAll(ACT_NAME_NO_YEAR_RE)) {
    const precedingWords = match[1].trim().split(/\s+/);
    const lastWord = precedingWords[precedingWords.length - 1];
    if (ACT_STOP_WORDS.has(lastWord.toLowerCase())) continue;
    // A leading "The"/"This" is not part of the name ("The Federal Arbitration Act"), so it is
    // dropped; otherwise the span never matches the statute's own Act name and a correct,
    // allowed reference gets blocked (US branch, 2026-09-26).
    const words = match[0].trim().split(/\s+/);
    while (words.length > 2 && ACT_STOP_WORDS.has(words[0].toLowerCase())) words.shift();
    spans.push(words.join(" "));
  }
  return spans;
}

export function findLegalReferences(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const found = new Map(); // lowercase key -> original-case span, de-duplicated
  for (const pattern of PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const span = match[0].trim();
      if (!span) continue;
      const key = span.toLowerCase();
      if (!found.has(key)) found.set(key, span);
    }
  }
  for (const span of findActNameSpans(text)) {
    const key = span.toLowerCase();
    if (!found.has(key)) found.set(key, span);
  }
  return [...found.values()];
}

// section: unsourced legal conclusions ------------------------------------------------
// These are not references at all: no Act, no section, nothing to attribute to a statute, but
// a legal-sounding conclusion ("this is void", "under Malaysian law", "you have a right") is
// exactly the kind of unverified legal assertion R2 exists to stop. There is no allowed-list
// check for these (see checkAnswer below): a span with no reference in it can never be
// attributed to a statute, so finding one always blocks the answer.
export const LEGAL_CONCLUSION_PATTERNS = [
  // "under law", "under the law", "under Malaysian law", "under US law", "under federal law",
  // "under New York law", "under state law" (up to two words between "under" and "law").
  /\bunder\s+(?:the\s+)?(?:[A-Za-z.]+\s+){0,2}law\b/gi,
  /\bthe\s+law\s+(?:says|requires|provides|states)\b/gi,
  /\bis\s+(?:void|voidable|illegal|unlawful|unenforceable|enforceable|legally\s+binding)\b/gi,
  /\byou\s+(?:have|are\s+entitled\s+to)\s+a\s+(?:legal\s+)?right\b/gi,
  /\b(?:breach|breaches)\s+(?:of\s+)?(?:the\s+)?(?:statute|act)\b/gi,
];

export function findLegalConclusions(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const found = new Map();
  for (const pattern of LEGAL_CONCLUSION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const span = match[0].trim();
      if (!span) continue;
      const key = span.toLowerCase();
      if (!found.has(key)) found.set(key, span);
    }
  }
  return [...found.values()];
}

// section: normalising for tolerant comparison ------------------------------------------------
// Why: an allowed statute's own label ("Copyright Act 1987 (Act 332), s.26(2)") and a span the
// model actually wrote ("section 26(2)") must compare equal even though one says "s." and the
// other spells out "section". Everything is folded to a common shorthand before comparing.

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/\bsections?\b/g, "s.")
    .replace(/\bseksyen\b/g, "s.")
    // "17 USC", "17 U.S.C" and "17 U. S. C." fold to "17 u.s.c." (US branch)
    .replace(/\bu\.?\s?s\.?\s?c\b\.?/g, "u.s.c.")
    // "17 USC 101" (no § sign) reads the same as "17 U.S.C. § 101"
    .replace(/u\.s\.c\.\s?(?=\d)/g, "u.s.c. s.")
    // "§ 204" and "§§ 201" fold to the same "s.204" as "section 204" (US branch)
    .replace(/§§?\s*/g, "s.")
    .replace(/\bss\.\s?/g, "s.")
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .trim();
}

// Plain String.includes() in both directions is not safe here: "s.2" is a substring of
// "s.26(2)", and "act 3" is a substring of "act 332", so a naive containment check lets an
// invented "section 2" pass as if it were the allowed "s.26(2)", or an invented "Act 3" pass
// as if it were the allowed "Act 332". This checks containment the same way, but only counts
// an occurrence when it is not glued to another letter or digit on either side, so "s.2" no
// longer matches inside "s.26(2)" (it is followed by "6", not a boundary) and "act 3" no
// longer matches inside "act 332" (it is followed by "3", not a boundary).
// The one deliberate exception: an opening parenthesis right after the match IS treated as a
// boundary, so a bare "s.26" still matches inside "s.26(2)" (the same section, just without
// stating the subsection) rather than being rejected for running into the "(".
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
  // Direction 1: the span sits inside one of the statute's own fields ("§ 2" inside "§ 2").
  const candidateFields = [statute.act, statute.act_no, statute.provision, statute.label_en, statute.label_ms];
  for (const field of candidateFields) {
    if (!field) continue;
    if (occursWithBoundary(normalize(field), normSpan)) return true;
  }
  // Direction 2: a whole field sits inside a longer span. Only the full label and the full Act
  // name may be used this way. A bare provision such as "§ 2" must not be, or "17 U.S.C. § 2"
  // (a different title) would pass as if it were "9 U.S.C. § 2" just because it ends in "§ 2"
  // (US branch, 2026-09-26).
  for (const field of [statute.act, statute.label_en]) {
    if (!field) continue;
    if (occursWithBoundary(normSpan, normalize(field))) return true;
  }
  return false;
}

// section: checking a model answer against the allowed statutes ------------------------------------------------
// allowedStatutes is the set of CITABLE statutes for this clause type only (never every
// statute in the table): mentioning a real, verified statute that just happens not to apply to
// this clause type is exactly as unattributable here as mentioning an invented one.

export function checkAnswer(answer, allowedStatutes) {
  const spans = findLegalReferences(answer);
  const statutes = allowedStatutes || [];
  const unmatchedRefs = spans.filter(
    (span) => !statutes.some((statute) => spanMatchesStatute(span, statute))
  );

  // Legal-conclusion spans carry no reference to attribute in the first place, so they are
  // never checked against allowedStatutes: finding one always blocks, prefixed "conclusion: "
  // so the decision trace shows why this is different from an unmatched reference.
  const unmatchedConclusions = findLegalConclusions(answer).map((span) => `conclusion: ${span}`);

  const unmatched = [...unmatchedRefs, ...unmatchedConclusions];
  return { ok: unmatched.length === 0, unmatched };
}
