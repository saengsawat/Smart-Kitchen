/**
 * Deterministic text normalization and term matching (M1-T4).
 *
 * This is the *only* place the engine looks at free text. Everything here is a
 * pure, total function of its inputs — no stemming library, no fuzzy/edit
 * distance, no probabilistic scoring, no locale-dependent behavior, no LLM
 * (CLAUDE.md rule 7, SR-1).
 *
 * ## The exact matching rules
 *
 * **Normalization** (`normalizeText`), applied identically to haystack text
 * and to every term before comparison:
 * 1. Unicode NFKD normalization, then strip combining marks — so `crème`
 *    becomes `creme` and a decomposed `é` cannot dodge a term.
 * 2. Lowercase via `toLowerCase()` (the whole pipeline is ASCII-only after
 *    step 3, so no locale-specific casing can change the outcome).
 * 3. Every character outside `[a-z0-9]` becomes a single space. This is what
 *    splits punctuation-joined words: `peanut-butter`, `soy(lecithin)`,
 *    `milk/cream`, `wheat.` all become space-separated tokens.
 * 4. Collapse runs of spaces and trim.
 *
 * **Tokenization** (`tokenize`): split the normalized string on single spaces.
 *
 * **Comparison** is *token-sequence equality*, never substring containment.
 * A term of n tokens matches at position i only if each of the n tokens
 * compares equal to the corresponding haystack token. This is what makes
 * `peanut` fail to match `pea`, and `pea` fail to match `peanut` — the
 * single most important negative property in this file.
 *
 * **The one inflection rule** (`tokensEqual`): a haystack token also matches a
 * term token when it is that token plus a literal `s` or `es` suffix
 * (so `peanuts` matches the term `peanut`). This is a fixed, enumerated
 * rule, *not* a stemmer: no `y`→`ies`, no consonant doubling, no
 * irregular plurals, no synonym generation. Anything that rule does not cover
 * (e.g. `anchovies` for `anchovy`) must be listed explicitly in the curated
 * term data — data, not inferred at runtime. The rule can only ever *widen*
 * matching (more matches = more blocking = the conservative direction).
 *
 * **Exclusion phrases** (`maskExclusions`): some allergen terms are legitimate
 * tokens of unrelated compound foods — `butter` in `peanut butter`, `flour` in
 * `rice flour`, `cream` in `cream of tartar`. Each allergen's curated data may
 * therefore list exclusion phrases that are masked out of the haystack
 * *before that allergen's terms are scanned*, and only for that allergen: the
 * peanut scan still sees `peanut butter` in full. Masking is longest-phrase
 * first (deterministic; a 3-token phrase wins over an overlapping 2-token one)
 * and a masked position can never be re-used by a term match.
 *
 * ## What this can and cannot establish
 *
 * A term match is *evidence of presence*. The absence of a term match is
 * **not** evidence of absence — the curated lists are incomplete by
 * construction and always will be. Nothing in this module may therefore be
 * used on its own to reach an `ALLOWED` verdict; see `screen.ts`, where
 * absence is only ever concluded from an explicit completeness declaration.
 */

/** A term occurrence found in tokenized text. */
export interface TermMatch {
  /** The curated/user term that matched, in its normalized form. */
  readonly term: string;
  /** The haystack tokens that matched, joined by spaces (normalized form). */
  readonly matchedText: string;
  /** Index of the first matched token. */
  readonly startToken: number;
  /** Index one past the last matched token. */
  readonly endToken: number;
}

/** A term pre-split into its normalized tokens (precomputed for the curated data). */
export interface CompiledTerm {
  readonly term: string;
  readonly tokens: readonly string[];
}

const COMBINING_MARKS = /[\u0300-\u036f]/g;
/**
 * Zero-width and bidi/format characters: soft hyphen, ZWSP/ZWNJ/ZWJ, LRM/RLM,
 * word joiner, and BOM/ZWNBSP. They are **deleted**, not turned into spaces \u2014
 * they are invisible, so a human reading `pea<ZWSP>nut` sees one word, and
 * letting the non-alphanumeric step turn them into a separator would split the
 * token and make the term miss (review finding F3: that produced `ALLOWED`
 * under a completeness declaration). Must run before {@link NON_ALNUM}.
 */
const ZERO_WIDTH_AND_FORMAT = /[\u00ad\u200b-\u200f\u2060\ufeff]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

/** Applies the normalization steps documented above. */
export function normalizeText(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(ZERO_WIDTH_AND_FORMAT, "")
    .toLowerCase()
    .replace(NON_ALNUM, " ")
    .trim();
}

/** Normalizes then splits into tokens. Returns `[]` for text with no alphanumerics. */
export function tokenize(raw: string): readonly string[] {
  const normalized = normalizeText(raw);
  return normalized === "" ? [] : normalized.split(" ");
}

/**
 * The single inflection rule: exact equality, or the haystack token is the
 * term token plus `s`/`es`. Nothing else — see the module docblock.
 */
export function tokensEqual(haystackToken: string, termToken: string): boolean {
  return (
    haystackToken === termToken ||
    haystackToken === `${termToken}s` ||
    haystackToken === `${termToken}es`
  );
}

/** Compiles a raw phrase into its normalized tokens. Phrases with no tokens compile to `undefined`. */
export function compileTerm(phrase: string): CompiledTerm | undefined {
  const tokens = tokenize(phrase);
  if (tokens.length === 0) return undefined;
  return { term: tokens.join(" "), tokens };
}

/** Compiles a list of phrases, dropping any that normalize to nothing. */
export function compileTerms(phrases: readonly string[]): readonly CompiledTerm[] {
  const compiled: CompiledTerm[] = [];
  for (const phrase of phrases) {
    const term = compileTerm(phrase);
    if (term !== undefined) compiled.push(term);
  }
  return compiled;
}

/** True when `term.tokens` matches `tokens` starting at `start`, respecting `masked`. */
function matchesAt(
  tokens: readonly string[],
  start: number,
  term: CompiledTerm,
  masked: readonly boolean[],
): boolean {
  if (start + term.tokens.length > tokens.length) return false;
  for (let offset = 0; offset < term.tokens.length; offset++) {
    if (masked[start + offset] === true) return false;
    const haystackToken = tokens[start + offset];
    const termToken = term.tokens[offset];
    if (haystackToken === undefined || termToken === undefined) return false;
    if (!tokensEqual(haystackToken, termToken)) return false;
  }
  return true;
}

/**
 * Marks every token covered by an exclusion phrase. Longest phrases are
 * applied first so that `gluten free flour` wins over `gluten free`; already
 * masked positions are never re-masked or re-matched.
 */
export function maskExclusions(
  tokens: readonly string[],
  exclusions: readonly CompiledTerm[],
): readonly boolean[] {
  const masked: boolean[] = new Array<boolean>(tokens.length).fill(false);
  if (exclusions.length === 0) return masked;

  const byLengthDesc = [...exclusions].sort((a, b) =>
    b.tokens.length !== a.tokens.length
      ? b.tokens.length - a.tokens.length
      : a.term.localeCompare(b.term),
  );

  for (const exclusion of byLengthDesc) {
    for (let start = 0; start + exclusion.tokens.length <= tokens.length; start++) {
      if (matchesAt(tokens, start, exclusion, masked)) {
        for (let offset = 0; offset < exclusion.tokens.length; offset++) {
          masked[start + offset] = true;
        }
      }
    }
  }
  return masked;
}

/**
 * Finds every occurrence of any `term` in `text`, after masking `exclusions`.
 *
 * Scanning is left-to-right by position; at each position the longest matching
 * term wins and the scan resumes after it, so a single span yields one match
 * and results are deterministic regardless of the order terms were listed in.
 */
export function findTermMatches(
  text: string,
  terms: readonly CompiledTerm[],
  exclusions: readonly CompiledTerm[] = [],
): readonly TermMatch[] {
  const tokens = tokenize(text);
  if (tokens.length === 0 || terms.length === 0) return [];

  const masked = maskExclusions(tokens, exclusions);
  const byLengthDesc = [...terms].sort((a, b) =>
    b.tokens.length !== a.tokens.length
      ? b.tokens.length - a.tokens.length
      : a.term.localeCompare(b.term),
  );

  const matches: TermMatch[] = [];
  let position = 0;
  while (position < tokens.length) {
    let found: TermMatch | undefined;
    for (const term of byLengthDesc) {
      if (matchesAt(tokens, position, term, masked)) {
        const endToken = position + term.tokens.length;
        found = {
          term: term.term,
          matchedText: tokens.slice(position, endToken).join(" "),
          startToken: position,
          endToken,
        };
        break;
      }
    }
    if (found === undefined) {
      position += 1;
    } else {
      matches.push(found);
      position = found.endToken;
    }
  }
  return matches;
}
