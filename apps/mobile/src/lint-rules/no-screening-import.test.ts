/// <reference types="node" />
/**
 * Proves the client never imports or calls the domain's allergen-screening
 * engine (M3-T4b invariant: "no allergen verdict, warning or unknown is
 * computed, inferred, softened or reordered in the client"). Belt-and-
 * suspenders alongside `domain-boundary.test.ts`'s eslint-rule proof: that
 * suite proves the *rule* rejects `@smart-kitchen/domain` imports in the
 * forms the M3-T1 review checked; this one greps the real, on-disk source
 * tree for the engine's own exported names, the same "scan real files, not
 * just an in-memory string" pattern `copy-scan.test.ts` uses for copy-deck
 * §10 — a second, independent check that nothing in `apps/mobile` ever
 * names `screenSubject`/`screenSubjects`/`partitionByVerdict` at all, bare
 * specifier or deep relative import alike.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The domain allergen-screening engine's own exported function names (packages/domain/src/allergens/screen.ts). */
const SCREENING_ENGINE_NAMES = ["screenSubject", "screenSubjects", "partitionByVerdict"] as const;

/**
 * Strips `/** *\/`/`/* *\/` block comments and `//` line comments before
 * scanning. Deliberately a simple regex, not a real tokenizer — good enough
 * for a grep-style check whose job is to ignore a doc comment that
 * *mentions* the engine's name for documentation purposes (several files
 * here explain, in prose, why the client does *not* call it — e.g.
 * `fixture-products.ts`'s own header names `screenSubject` to say the
 * generator script runs it, this module does not), while still catching a
 * genuine import specifier or call expression anywhere in real code.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
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

describe("apps/mobile never names the domain's screening engine (M3-T4b, grep-style)", () => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(moduleDir, "..", "..", "..", "..");
  const roots = ["apps/mobile/src", "apps/mobile/app"].map((p) => path.join(repoRoot, p));

  it("scans at least one real file (not vacuously passing)", () => {
    const files = roots.flatMap(listSourceFiles);
    expect(files.length).toBeGreaterThan(10);
  });

  it("contains zero real (non-comment) references to screenSubject/screenSubjects/partitionByVerdict", () => {
    const files = roots.flatMap(listSourceFiles);
    const violations: { file: string; name: string }[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const name of SCREENING_ENGINE_NAMES) {
        if (new RegExp(`\\b${name}\\b`).test(code)) {
          violations.push({ file: path.relative(repoRoot, file), name });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the comment-stripped scan still catches a real reference (the check itself is not vacuously passing)", () => {
    const stripped = stripComments(
      '/** mentions screenSubject in prose only */\nimport { screenSubject } from "@smart-kitchen/domain";\n',
    );
    expect(/\bscreenSubject\b/.test(stripped)).toBe(true);
  });
});
