/**
 * Recommendations-corpus mirror consistency check (M1-T10-i).
 *
 * `packages/domain/src/allergens/corpus.test.ts` asserts the screening engine
 * against an in-file mirror of `tests/fixtures/recommendations/**\/*.json`
 * (M1-T4's fallback for a package that must stay zero-I/O: it cannot read the
 * JSON files itself, so the cases are duplicated in TypeScript instead). That
 * leaves the two copies free to drift — someone edits the JSON to fix a case
 * and forgets the mirror, or vice versa — with nothing catching it until a
 * human notices the JSON is no longer what the domain suite actually runs
 * against.
 *
 * This suite lives here specifically because it *can* do I/O
 * (`packages/adapters`'s tsconfig declares `@types/node`, unlike domain's) and
 * asserts, file by file, that the mirror `packages/domain` re-exports
 * (`RECOMMENDATIONS_CORPUS_CASES`/`RECOMMENDATIONS_CORPUS_CASE_FILES`, moved
 * to `packages/domain/src/allergens/test-support.ts` for exactly this reason)
 * is byte-for-byte identical, as parsed JSON, to what is actually checked in
 * under `tests/fixtures/recommendations/`.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RECOMMENDATIONS_CORPUS_CASE_FILES,
  RECOMMENDATIONS_CORPUS_CASES,
  type RecommendationsCorpusCase,
} from "@smart-kitchen/domain";
import { RECOMMENDATIONS_FIXTURES_DIR } from "./fixture-paths.js";

function actualFixtureFilenames(): string[] {
  return readdirSync(RECOMMENDATIONS_FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function loadFixture(filename: string): unknown {
  return JSON.parse(readFileSync(path.join(RECOMMENDATIONS_FIXTURES_DIR, filename), "utf8"));
}

describe("recommendations-corpus mirror vs tests/fixtures/recommendations/**/*.json", () => {
  it("CASE_FILES lists exactly the .json files present on disk — no more, no fewer", () => {
    expect([...RECOMMENDATIONS_CORPUS_CASE_FILES].sort()).toEqual(actualFixtureFilenames());
  });

  it("CASES has exactly one entry per CASE_FILES entry, in the same order", () => {
    expect(RECOMMENDATIONS_CORPUS_CASES.length).toBe(RECOMMENDATIONS_CORPUS_CASE_FILES.length);
    expect(RECOMMENDATIONS_CORPUS_CASES.map((c) => c.caseId)).toEqual(
      RECOMMENDATIONS_CORPUS_CASE_FILES.map((f) => f.replace(/\.json$/, "")),
    );
  });

  it.each(RECOMMENDATIONS_CORPUS_CASE_FILES.map((filename, index) => [filename, index] as const))(
    "%s: the mirrored case is exactly the parsed JSON file (no drift)",
    (filename, index) => {
      const onDisk = loadFixture(filename);
      const mirrored: RecommendationsCorpusCase | undefined = RECOMMENDATIONS_CORPUS_CASES[index];
      expect(mirrored, `no mirrored case at index ${String(index)} for ${filename}`).toBeDefined();
      // Deep-equal against the raw parsed JSON — not a field-by-field
      // comparison — so an added, removed, or renamed field on either side
      // fails this test rather than passing unnoticed.
      expect(mirrored).toEqual(onDisk);
    },
  );

  it("includes the M1-T6 fixture (screening-016)", () => {
    expect(RECOMMENDATIONS_CORPUS_CASE_FILES).toContain(
      "screening-016-malformed-allergens-not-allowed.json",
    );
    expect(RECOMMENDATIONS_CORPUS_CASES.some((c) => c.caseId.startsWith("screening-016"))).toBe(
      true,
    );
  });
});
