/// <reference types="node" />
/**
 * Forbidden-word / em-dash copy scan (M3-T2, BACKLOG.md M3-T2 invariant).
 *
 * copy-deck.md §10's grep gate ("safe", "passed", "allergen-free",
 * "guaranteed", "verified safe" and the em dash U+2014 must return zero hits)
 * is written against the copy deck itself; this suite applies the same gate
 * to the client's actual string literals under `apps/mobile/src` and
 * `apps/mobile/app`, per the M3-T2 invariant: "add a test that scans every
 * string literal ... for copy-deck §10 terms and U+2014, with the caveat
 * sentence as the one allowed `safe`."
 *
 * Scans TypeScript **string-literal AST nodes** (via the `typescript`
 * compiler API, already a root devDependency — the same tool
 * `src/lint-rules/domain-boundary.test.ts` uses "eslint"/"typescript-eslint"
 * from), not raw file text or a regex over the whole file: a plain-text grep
 * would also match comments (e.g. "bypassed", "safe to re-enter" in doc
 * comments elsewhere in this codebase) and import module specifiers (e.g.
 * `"react-native-safe-area-context"`, `"expo-safe-area-context"`-style
 * paths), neither of which is UI copy. Import/export module specifiers and
 * type-position string literals (`"standard" | "severe"`-style unions, never
 * rendered) are excluded for the same reason; every other string literal —
 * including every `accessibilityLabel`, button label and inline message — is
 * in scope, because those *are* copy a user reads or a screen reader speaks.
 *
 * `*.test.ts(x)` files are excluded from the scanned corpus (not shipped as
 * app copy) but this suite's own first block proves the rule actually catches
 * every forbidden term using in-memory source strings, the same pattern
 * `domain-boundary.test.ts` uses to test a rule without adding an on-disk
 * fixture that would itself need to violate the thing being tested.
 *
 * apps/mobile's tsconfig sets `"types": []` so `@types/node` is not
 * auto-included project-wide (M3-T1 invariant); this file genuinely runs
 * under Node (vitest, scanning real files on disk), so it opts itself in
 * with a file-scoped `/// <reference types="node" />` rather than adding
 * "node" to the project's shared `types` array. `@types/node` is added to
 * this app's devDependencies for this one file, the same way
 * `packages/adapters` already carries it for its own real-fs test
 * (`recommendations-corpus-consistency.test.ts`).
 *
 * **Correction (M3-T2 review F3):** an earlier version of this comment
 * claimed the triple-slash reference kept Node's ambient globals scoped to
 * this file alone. That is false: TypeScript ambient global declarations are
 * program-wide once any file in the compilation pulls them in, so
 * `process.env`, `Buffer`, `NodeJS.Timeout`, etc. type-checked from every
 * other file in this app too (the review proved it from
 * `src/onboarding/validation.ts`). The actual containment is an eslint rule
 * (`eslint.config.js`, `no-restricted-globals` for `process`/`Buffer`/
 * `__dirname`/`__filename`/`global`, scoped to `apps/mobile/app/**` and
 * `apps/mobile/src/**` with an exception for `src/lint-rules/**`), which
 * blocks *using* those globals outside this directory even though the types
 * remain technically visible everywhere. Extended (review F19) with
 * `no-restricted-properties` for `globalThis.process`/`.Buffer`/etc., which
 * reach the same ambient globals by member access rather than a bare
 * identifier reference. Neither rule (nor anything else here) tries to hide
 * the *types* themselves (`NodeJS.Timeout`, `NodeJS.ProcessEnv`, and so on
 * remain visible everywhere by design, the same way `@types/react`'s types
 * are visible without every file needing to use them): a type has no runtime
 * access to a global's value, so only the value references are worth
 * restricting.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const EM_DASH = "—";

/**
 * copy-deck.md §10's grep gate, case-insensitive substring match (same as its
 * own literal grep gate). Both "guarantee" and "guaranteed" are listed (review
 * F12) even though "guarantee" alone would already substring-match
 * "guaranteed": listing both keeps the reported term name accurate to what a
 * reviewer typed, and matches the deck's own table, which names both forms.
 */
const FORBIDDEN_TERMS = [
  "safe",
  "passed",
  "allergen-free",
  "guarantee",
  "guaranteed",
  "verified safe",
] as const;

/** The one named exception (copy-deck.md §10/§3.1): the standing NO_SAFETY_GUARANTEE caveat, verbatim. */
const ALLOWED_SAFE_SENTENCE = "Known matches only · not a guarantee this food is safe.";

interface Violation {
  readonly file: string;
  readonly term: string;
  readonly text: string;
}

/** True for a string literal whose parent means it is not rendered UI copy. */
function isExemptPosition(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return true; // module specifier, e.g. "react-native-safe-area-context"
  }
  if (ts.isLiteralTypeNode(parent)) {
    return true; // type-position literal, e.g. "standard" | "severe" unions
  }
  return false;
}

function checkLiteralText(file: string, text: string, violations: Violation[]): void {
  if (text === ALLOWED_SAFE_SENTENCE) {
    return;
  }
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    if (lower.includes(term)) {
      violations.push({ file, term, text });
    }
  }
  if (text.includes(EM_DASH)) {
    violations.push({ file, term: "em dash (U+2014)", text });
  }
}

/** Scans one TypeScript/TSX source string for copy-deck §10 violations in its string literals. */
export function scanSourceForViolations(sourceText: string, fileName = "virtual.tsx"): Violation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    // review F1: JSX text (e.g. `<Text>Sign in to start your kitchen.</Text>`)
    // is a distinct AST node kind from a string literal — the original scan
    // only visited isStringLiteralLike/isTemplateLiteralToken, so plain JSX
    // text content, which is most of this app's actual visible copy, was
    // never checked at all.
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) &&
      !isExemptPosition(node)
    ) {
      checkLiteralText(fileName, node.text, violations);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

function isTestFile(fileName: string): boolean {
  return /\.test\.tsx?$/.test(fileName);
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !isTestFile(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("scanSourceForViolations (the rule itself, in-memory sources)", () => {
  it.each(FORBIDDEN_TERMS)("catches %s in a plain string literal", (term) => {
    const violations = scanSourceForViolations(`export const x = "this is ${term} text";\n`);
    expect(violations.some((v) => v.term === term)).toBe(true);
  });

  it("catches a forbidden term case-insensitively", () => {
    const violations = scanSourceForViolations('export const x = "GUARANTEED to work";\n');
    expect(violations.some((v) => v.term === "guaranteed")).toBe(true);
  });

  it("catches a forbidden term inside a template literal", () => {
    const violations = scanSourceForViolations("export const x = `passed the check`;\n");
    expect(violations.some((v) => v.term === "passed")).toBe(true);
  });

  it("catches an em dash in a string literal", () => {
    const violations = scanSourceForViolations(`export const x = "one ${EM_DASH} two";\n`);
    expect(violations.some((v) => v.term.startsWith("em dash"))).toBe(true);
  });

  it("allows the exact standing caveat sentence and nothing else containing 'safe'", () => {
    const violations = scanSourceForViolations(`export const x = "${ALLOWED_SAFE_SENTENCE}";\n`);
    expect(violations).toEqual([]);
  });

  it("still flags a near-miss of the caveat sentence (not an exact match)", () => {
    const violations = scanSourceForViolations('export const x = "This food is safe.";\n');
    expect(violations.some((v) => v.term === "safe")).toBe(true);
  });

  it("does not flag an import module specifier containing 'safe'", () => {
    const violations = scanSourceForViolations(
      'import { useSafeAreaInsets } from "react-native-safe-area-context";\nexport const x = useSafeAreaInsets;\n',
    );
    expect(violations).toEqual([]);
  });

  it("does not flag a type-position string-literal union", () => {
    const violations = scanSourceForViolations(
      'export type Severity = "standard" | "severe";\nexport const x: Severity = "standard";\n',
    );
    expect(violations).toEqual([]);
  });

  it("allows ordinary copy with none of the forbidden terms", () => {
    const violations = scanSourceForViolations('export const x = "No known allergies for Maya";\n');
    expect(violations).toEqual([]);
  });

  it("catches a forbidden term in JSX text content (not just string-literal props)", () => {
    // Mutation-style regression (review F1): this passes only because `visit`
    // also checks ts.isJsxText — deleting that branch (as the original scan
    // shipped) makes this fail, since "guaranteed" here is JSX text, not a
    // string literal or template literal.
    const violations = scanSourceForViolations(
      "export function X() { return <Text>This is guaranteed to work</Text>; }\n",
    );
    expect(violations.some((v) => v.term === "guaranteed")).toBe(true);
  });

  it("does not flag ordinary JSX text with none of the forbidden terms", () => {
    const violations = scanSourceForViolations(
      "export function X() { return <Text>Continue with email</Text>; }\n",
    );
    expect(violations).toEqual([]);
  });
});

describe("apps/mobile/src and apps/mobile/app: every string literal, copy-deck.md §10", () => {
  // Derived from this file's own location (review opinion), not
  // process.cwd(): robust to whatever directory the test runner is invoked
  // from, and this file is the one place in apps/mobile that legitimately
  // needs a real repo-root path (see the file's own doc comment on
  // `/// <reference types="node" />` for why Node types are scoped to this
  // directory rather than project-wide).
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(moduleDir, "..", "..", "..", "..");
  const roots = ["apps/mobile/src", "apps/mobile/app"].map((p) => path.join(repoRoot, p));

  it("scans at least one real file (the scan itself is not vacuously passing)", () => {
    const files = roots.flatMap(listSourceFiles);
    expect(files.length).toBeGreaterThan(10);
  });

  it("contains zero forbidden-word or em-dash violations", () => {
    const files = roots.flatMap(listSourceFiles);
    const allViolations: Violation[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const relative = path.relative(repoRoot, file);
      for (const v of scanSourceForViolations(text, file)) {
        allViolations.push({ ...v, file: relative });
      }
    }
    expect(allViolations).toEqual([]);
  });
});
