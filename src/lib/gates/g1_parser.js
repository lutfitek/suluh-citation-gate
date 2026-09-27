// src/lib/gates/g1_parser.js
//
// What this does: an alternative to citations.js's boundary-aware substring matching. Every
// span findLegalReferences() detects, and every allowed statute's own fields, is parsed into
// structured parts (title/code, Act name, section, subsection path) and compared part by part.
// A span is attributable only when its parts are consistent with one allowed statute: same
// title where the span states one, same section where the span states one, and a subsection
// that is either absent from the span or equal to/within the statute's own subsection.
// What it must never do: rewrite or correct the model's answer, call a model, use embeddings
// or similarity search, or pass a span whose parts cannot be parsed (an unparseable span always
// blocks, the safe direction, same rule citations.js uses for an unmatched span).
// Hard requirement served: R2 (no legal reference reaches the user unless it is attributable to
// one of the clause type's verified, citable statutes).
// Developed by Lutfitek.

import { findLegalReferences, findLegalConclusions } from "../citations.js";

export const id = "g1_parser";
export const description =
  "Structured citation parser: parses every reference and every allowed statute into " +
  "{title, act, section, subsections} and compares parts instead of matching substrings.";

// section: title/code matchers ------------------------------------------------
// Each entry recognises one way a US title or code is written. Order matters only in that a
// numbered form (captures the title number, e.g. "17 U.S.C.") must be tried before the bare
// form of the same code, so "17 U.S.C." keys as "usc:17" rather than the less specific "usc:".
// A title match never itself proves attribution: it only narrows which statute a section number
// is allowed to belong to.

const TITLE_MATCHERS = [
  { regex: /(\d+)\s*u\.?\s?s\.?\s?c\.?(?:\s?a\.?)?/i, key: (m) => `usc:${m[1]}` },
  { regex: /u\.?\s?s\.?\s?c\.?(?:\s?a\.?)?/i, key: () => "usc:" },
  { regex: /(\d+)\s*c\.?\s?f\.?\s?r\.?/i, key: (m) => `cfr:${m[1]}` },
  { regex: /c\.?\s?f\.?\s?r\.?/i, key: () => "cfr:" },
  {
    regex: /n\.?\s?y\.?\s?c\.?\s*civ\.?\s*ct\.?\s*act|new\s+york\s+city\s+civil\s+court\s+act/i,
    key: () => "nycca",
  },
  { regex: /c\.?\s?p\.?\s?l\.?\s?r\.?/i, key: () => "cplr" },
  { regex: /gbl|gen\.?\s*bus\.?\s*law|general\s+business\s+law/i, key: () => "gbl" },
  { regex: /uniform\s+commercial\s+code|u\.?\s?c\.?\s?c\.?/i, key: () => "ucc" },
];

// Finds the first title token inside `text`, wherever it sits, and reports where it ends so the
// caller can look at whatever comes right after it (the section, if any).
function matchTitle(text) {
  for (const matcher of TITLE_MATCHERS) {
    const m = matcher.regex.exec(text);
    if (m) return { key: matcher.key(m), endIndex: m.index + m[0].length };
  }
  return null;
}

// Same search, but only the key is wanted (used on a statute's own act_no/label_en fields).
function findTitleKey(text) {
  if (!text) return null;
  const found = matchTitle(text);
  return found ? found.key : null;
}

// section: section and subsection parsing ------------------------------------------------
// A "subsection path" is the sequence of parenthetical parts right after the main number, e.g.
// "204(a)" -> section "204", subsections ["a"]; "1410(3)" -> section "1410", subsections ["3"].

function readSubsections(tail) {
  const subsections = [];
  let rest = tail;
  const subRe = /^\s?\(([A-Za-z0-9]+)\)/;
  while (true) {
    const sm = subRe.exec(rest);
    if (!sm) break;
    subsections.push(sm[1].toLowerCase());
    rest = rest.slice(sm[0].length);
  }
  return subsections;
}

// Standalone section reference: requires an explicit marker (section/sec./s./§) before the
// number, because a bare number floating in text with no marker is not itself a legal reference
// (findLegalReferences never produces a "section-only" span without one of these markers, so
// this requirement never rejects anything the baseline itself would have found).
const SECTION_TOKEN_RE = /(?:§+|\bsections?\b|\bseksyen\b|\bsecs?\.?\b|\bs\.?\b)\s*(\d+[A-Za-z]?)/i;

function matchSection(text) {
  const m = SECTION_TOKEN_RE.exec(text);
  if (!m) return null;
  const section = m[1].toLowerCase();
  const tail = text.slice(m.index + m[0].length);
  return { section, subsections: readSubsections(tail) };
}

// Section reference immediately after a title. Here the marker is optional: "CPLR 213(2)",
// "GBL 1411" and "17 U.S.C. 204" are all conventional US citation styles that state the number
// right after the code name with no "§" or "section" word at all (the baseline's own CPLR/GBL/
// USC patterns allow this too: their section part is optional and marker-free). Using an
// optional-marker match here, but only right after a title has already been confirmed, keeps
// this safe: a bare number is never treated as a section unless a title is already anchoring it.
function matchSectionAfterTitle(text) {
  const m = /^\s*(?:§+|\bsections?\b|\bsecs?\.?\b|\bs\.?\b)?\s*(\d+[A-Za-z]?)/i.exec(text);
  if (!m || !m[1]) return null;
  const section = m[1].toLowerCase();
  const tail = text.slice(m.index + m[0].length);
  return { section, subsections: readSubsections(tail) };
}

// A statute's own provision field (e.g. "§ 106A(a)", "§ 1410(3)") parses the same way. label_en
// is tried too because it is the fallback (the baseline uses it the same way).
function statuteSection(statute) {
  return matchSection(statute.provision || "") || matchSection(statute.label_en || "");
}

function statuteTitle(statute) {
  return findTitleKey(statute.act_no || "") || findTitleKey(statute.label_en || "");
}

// A span's subsection is within a statute's subsection when the span states none at all (it
// made no specific claim), or when the statute's own provision states none (the whole section
// was verified, so any subsection of it is covered), or when one path is a prefix of the other.
function subsectionWithin(spanSubs, statuteSubs) {
  if (spanSubs.length === 0 || statuteSubs.length === 0) return true;
  const len = Math.min(spanSubs.length, statuteSubs.length);
  for (let i = 0; i < len; i++) {
    if (spanSubs[i] !== statuteSubs[i]) return false;
  }
  return true;
}

// section: Act names (no section at all) ------------------------------------------------
// A span that is nothing but an Act's common name ("the Federal Arbitration Act", "Copyright
// Act 1987") carries no section claim, so it is attributable whenever some allowed statute's Act
// matches, regardless of which section that statute happens to cite.

const ACT_NAME_SPAN_RE =
  /^(?:(?:the|this|that)\s+)?((?:[A-Z][a-zA-Z'.-]*\s+){0,6}Act)(?:\s+(\d{4}))?$/;

function matchActNameSpan(span) {
  const m = ACT_NAME_SPAN_RE.exec(span);
  if (!m) return null;
  const noYear = normalizeAct(m[1]);
  const withYear = m[2] ? normalizeAct(`${m[1]} ${m[2]}`) : null;
  return { noYear, withYear };
}

function normalizeAct(text) {
  return text
    .toLowerCase()
    .replace(/^(?:the|this|that|an|a)\s+/, "")
    .replace(/[.,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Every surface form a statute's Act can legitimately be called: its own `act` field with and
// without a trailing "(17 U.S.C.)"-style parenthetical, that same field with any trailing year
// dropped, and, when its source_title carries a parenthetical Act name of its own (a common
// pattern for a statute filed under a broader code, e.g. "article 44-A (Freelance Isn't Free
// Act)"), that alternate name too. Reading the alias out of source_title this way, rather than
// hardcoding any one Act's alternate name, keeps this general to any statute shaped like it.
function actAliases(statute) {
  const aliases = new Set();
  if (statute.act) {
    const withoutParen = statute.act.replace(/\s*\([^)]*\)\s*$/, "").trim();
    aliases.add(normalizeAct(statute.act));
    aliases.add(normalizeAct(withoutParen));
    aliases.add(normalizeAct(withoutParen.replace(/\s+\d{4}$/, "")));
  }
  if (statute.source_title) {
    const m = /\(([^)]*\bAct\b[^)]*)\)/i.exec(statute.source_title);
    if (m) aliases.add(normalizeAct(m[1]));
  }
  aliases.delete("");
  return aliases;
}

// section: legacy numbered-Act form ("Act 332") ------------------------------------------------
// Kept for statutes filed the way citations.js's own MY-branch fixtures are (an Act identified
// by a bare number, with no separate title/code and no year), so this gate does not regress on
// that citation style even though the seed data now in use is US-only.

const NUMBERED_ACT_RE = /^(?:Act|Akta)\s+(\d+[A-Za-z]?)$/i;

// section: parsing one detected span into its structured parts ------------------------------

function parseSpan(span) {
  const s = span.trim();

  const title = matchTitle(s);
  if (title) {
    const rest = s.slice(title.endIndex);
    const section = matchSectionAfterTitle(rest);
    if (section) {
      return { kind: "title-section", title: title.key, section: section.section, subsections: section.subsections };
    }
    return { kind: "title-only", title: title.key };
  }

  const section = matchSection(s);
  if (section) {
    return { kind: "section-only", section: section.section, subsections: section.subsections };
  }

  const actName = matchActNameSpan(s);
  if (actName) {
    return { kind: "act-only", noYear: actName.noYear, withYear: actName.withYear };
  }

  const numbered = NUMBERED_ACT_RE.exec(s);
  if (numbered) {
    return { kind: "numbered-act", actNo: normalizeAct(s) };
  }

  // Case citations ("X v Y"), Article/Amendment/Constitution/Restatement/Order/Rules of Court
  // references and anything else that does not fit one of the shapes above cannot be compared
  // to a statute's fields at all: unparseable always means unattributable.
  return null;
}

// section: context, for disambiguating a bare section reference -----------------------------
// "§ 2" on its own states no title. If two allowed statutes both happen to cite a section
// numbered "2" under different titles, a bare "§ 2" cannot be attributed to either UNLESS the
// surrounding answer also names a title or an Act, in which case it is bound to whichever
// candidate that context actually matches. Scanning the whole answer (not just the one span)
// for title and Act mentions is what lets "section 201(b) of the Copyright Act" tie its bare
// section to the right Act, and what stops a bare "§ 2" passing under a title the text never
// claimed for it.

function collectContextTitles(answer) {
  const titles = new Set();
  for (const matcher of TITLE_MATCHERS) {
    const re = new RegExp(matcher.regex.source, "gi");
    for (const m of answer.matchAll(re)) titles.add(matcher.key(m));
  }
  return titles;
}

const ACT_NAME_GLOBAL_RE = /\b((?:[A-Z][a-zA-Z'.-]*\s+){1,6}Act)(?:\s+(\d{4}))?\b/g;

function collectContextActs(answer) {
  const acts = new Set();
  for (const m of answer.matchAll(ACT_NAME_GLOBAL_RE)) {
    acts.add(normalizeAct(m[1]));
    if (m[2]) acts.add(normalizeAct(`${m[1]} ${m[2]}`));
  }
  return acts;
}

// section: attributing one parsed span to the allowed statutes ------------------------------

function sectionMatches(statute, parsed) {
  const stSection = statuteSection(statute);
  if (!stSection) return false;
  if (stSection.section !== parsed.section) return false;
  return subsectionWithin(parsed.subsections, stSection.subsections);
}

function isAttributable(parsed, statutes, contextTitles, contextActs) {
  switch (parsed.kind) {
    case "title-section":
      return statutes.some((st) => statuteTitle(st) === parsed.title && sectionMatches(st, parsed));

    case "title-only":
      return statutes.some((st) => statuteTitle(st) === parsed.title);

    case "act-only":
      return statutes.some((st) => {
        const aliases = actAliases(st);
        return aliases.has(parsed.noYear) || (parsed.withYear && aliases.has(parsed.withYear));
      });

    case "numbered-act":
      return statutes.some((st) => st.act_no && normalizeAct(st.act_no) === parsed.actNo);

    case "section-only": {
      const candidates = statutes.filter((st) => sectionMatches(st, parsed));
      if (candidates.length === 0) return false;
      if (candidates.length === 1) {
        // Attributable unless the answer explicitly names a different title elsewhere: a real
        // title claim elsewhere in the text that does not match this candidate means the bare
        // section almost certainly belongs to that other title, not to this candidate's.
        const title = statuteTitle(candidates[0]);
        if (title && contextTitles.size > 0 && !contextTitles.has(title)) return false;
        return true;
      }
      // More than one allowed statute shares this section number: only the answer's own context
      // (a title or an Act name mentioned anywhere in it) can say which one is meant.
      const filtered = candidates.filter((st) => {
        const title = statuteTitle(st);
        if (title && contextTitles.has(title)) return true;
        const aliases = actAliases(st);
        for (const act of contextActs) {
          if (aliases.has(act)) return true;
        }
        return false;
      });
      return filtered.length === 1;
    }

    default:
      return false;
  }
}

// section: checking a model answer against the allowed statutes ------------------------------

export function checkAnswer(answer, allowedStatutes) {
  const statutes = allowedStatutes || [];
  const spans = findLegalReferences(answer);
  const contextTitles = collectContextTitles(answer);
  const contextActs = collectContextActs(answer);

  const unmatchedRefs = spans.filter((span) => {
    const parsed = parseSpan(span);
    if (!parsed) return true; // unparseable: block, the safe direction
    return !isAttributable(parsed, statutes, contextTitles, contextActs);
  });

  // Legal conclusions carry no reference to attribute in the first place: same rule as
  // citations.js, finding one always blocks, prefixed so the decision trace shows why.
  const unmatchedConclusions = findLegalConclusions(answer).map((span) => `conclusion: ${span}`);

  const unmatched = [...unmatchedRefs, ...unmatchedConclusions];
  return { ok: unmatched.length === 0, unmatched };
}
