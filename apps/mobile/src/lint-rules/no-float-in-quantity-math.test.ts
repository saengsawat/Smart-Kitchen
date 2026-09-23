/// <reference types="node" />
/**
 * Structural guard (review round 3, R1(b)): proves `src/scan/quantity.ts`
 * and `src/inventory/quantity.ts` — the two modules CLAUDE.md rule 7 and
 * this ticket's own invariant hold to "no float anywhere in quantity math"
 * — never call `Number(...)`, `parseFloat`, `parseInt` or `.toFixed(...)`
 * anywhere in their real code. `Number.isInteger`/`Number.isNaN` are
 * allowed (pure predicates on an already-integer `count`, never a parse or
 * a rounding step).
 *
 * Same "grep-style, comment-stripped" pattern as `no-screening-import.test.ts`:
 * both files' own doc comments *name* `Number`/`parseFloat`/`.toFixed` in
 * prose (to explain what they deliberately avoid), so a bare substring
 * search would false-positive on the very sentences documenting the
 * invariant. Comments are stripped first; only real code is scanned.
 *
 * R1's finding: a pinned unit-test value alone does not prove this
 * (`8.675309` turned out to be exactly representable through
 * `Number(...) * 1e6`, so that pin proved nothing about avoiding float
 * arithmetic). This structural check is the actual enforcement — it fails
 * the moment either file's implementation is rewritten to go through
 * `Number`/`parseFloat`/`parseInt`/`.toFixed`, regardless of which test
 * values happen to still pass.
 *
 * Follow-up finding (same review): `BigInt(Math.round(+unsigned * 1_000_000))`
 * dodges every pattern above — unary `+` is not the identifier `Number`, and
 * `Math.round` keeps enough precision that a pinned test value can still
 * pass — while still routing the amount through IEEE754 double arithmetic.
 * `Math.*` is therefore forbidden outright too: neither guarded module has
 * any legitimate use for it (there is no rounding, trigonometry, or anything
 * else `Math` provides that exact `bigint` splitting needs).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(moduleDir, "..", "..", "..", "..");

const GUARDED_FILES = [
  path.join(repoRoot, "apps", "mobile", "src", "scan", "quantity.ts"),
  path.join(repoRoot, "apps", "mobile", "src", "inventory", "quantity.ts"),
];

/** Same simple block/line-comment stripper as `no-screening-import.test.ts` — good enough for a grep-style check, not a full tokenizer. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Forbidden patterns, checked against comment-stripped code:
 * - `Number(` — a call, never matches `Number.isInteger(`/`Number.isNaN(`
 *   (those have a `.` immediately after `Number`, not `(`).
 * - `parseFloat`/`parseInt` — any mention at all; there is no legitimate
 *   use of either in code that must stay exact.
 * - `.toFixed(` — a call, the classic float-rounding-for-display method.
 * - `Math.` — any member of the `Math` namespace at all (`Math.round`,
 *   `Math.trunc`, `Math.floor`, …); the follow-up finding's escape
 *   (`BigInt(Math.round(+unsigned * 1_000_000))`) uses unary `+` instead of
 *   the identifier `Number` to coerce to a double, so this pattern is the
 *   one that actually closes it — neither guarded module has any
 *   legitimate reason to reach for `Math` at all.
 */
const FORBIDDEN_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "Number(...)", pattern: /\bNumber\(/ },
  { name: "parseFloat", pattern: /\bparseFloat\b/ },
  { name: "parseInt", pattern: /\bparseInt\b/ },
  { name: ".toFixed(...)", pattern: /\.toFixed\(/ },
  { name: "Math.*", pattern: /\bMath\./ },
];

function violationsIn(code: string): string[] {
  const found: string[] = [];
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      found.push(name);
    }
  }
  return found;
}

describe("src/scan/quantity.ts and src/inventory/quantity.ts never route through a float parse (review R1(b))", () => {
  it.each(GUARDED_FILES)("%s contains none of Number()/parseFloat/parseInt/.toFixed()", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    expect(violationsIn(code)).toEqual([]);
  });

  it("Number.isInteger and Number.isNaN are not flagged (pure predicates on an already-integer value)", () => {
    const code = stripComments(readFileSync(GUARDED_FILES[0]!, "utf8"));
    expect(code).toMatch(/Number\.isInteger\(/);
    expect(violationsIn(code)).toEqual([]);
  });

  it("mutation check: the guard actually catches a Number(...)-based parse (not vacuously passing)", () => {
    const mutated =
      "export function bad(text: string): number { return Number(text) * 1_000_000; }\n";
    expect(violationsIn(stripComments(mutated))).toContain("Number(...)");
  });

  it("mutation check: catches parseFloat, parseInt and .toFixed individually", () => {
    expect(violationsIn("parseFloat(x)")).toContain("parseFloat");
    expect(violationsIn("parseInt(x, 10)")).toContain("parseInt");
    expect(violationsIn("(x * 1e6).toFixed(0)")).toContain(".toFixed(...)");
  });

  it("mutation check: catches the unary-plus + Math.round escape that dodges Number(...) entirely", () => {
    // The exact escape the follow-up review found: no `Number(` identifier
    // anywhere, yet still a double-precision float parse under the hood.
    const escape = "BigInt(Math.round(+unsigned * 1_000_000))";
    expect(violationsIn(escape)).not.toContain("Number(...)"); // confirms it really does dodge that pattern
    expect(violationsIn(escape)).toContain("Math.*");
  });

  it("does not flag a doc comment that merely names these functions in prose", () => {
    const commented =
      "/**\n * Never calls Number(...), parseFloat, parseInt or .toFixed here.\n */\nexport const x = 1;\n";
    expect(violationsIn(stripComments(commented))).toEqual([]);
  });
});
