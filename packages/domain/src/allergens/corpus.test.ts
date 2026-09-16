/**
 * Corpus tests mirroring `tests/fixtures/recommendations/**`.
 *
 * **Why the cases are duplicated here.** The JSON files in
 * `tests/fixtures/recommendations/` are the durable artifact (testing-strategy.md
 * §3) and are what M6's eval tests will consume. This suite cannot read them:
 * `packages/domain` is the zero-I/O core and deliberately has no `@types/node`
 * and no `"types": ["node"]` in its tsconfig (unlike `packages/adapters`, which
 * declares both), so `node:fs` does not even typecheck here — and giving the
 * domain package filesystem types to run a test would weaken exactly the
 * boundary that makes it the deterministic core. The M1-T4 dispatch anticipated
 * this and specified the fallback taken here: keep the JSON as the durable
 * artifact and mirror the cases as in-file constants.
 *
 * **Keeping the two in step.** `CASE_FILES`/`CASES` below are re-exported from
 * `test-support.ts` (M1-T10-i, moved there — a pure move, no behaviour
 * change — from this file), which is what lets
 * `packages/adapters/src/product-lookup/recommendations-corpus-consistency.test.ts`
 * — outside packages/domain, which stays I/O-free and cannot read the JSON
 * files itself — import the exact same mirror this suite asserts against and
 * compare it against every file in `tests/fixtures/recommendations/` on disk,
 * so the two cannot silently drift apart (the mechanical consistency check
 * proposed as a follow-up in `docs/handoff/M1-T4.worker.md`).
 */

import { describe, expect, it } from "vitest";

import {
  MAJOR_ALLERGEN_CODES,
  normalizeAllergenCode,
  screenSubject,
  type ScreenedMember,
  type ScreeningSubjectInput,
} from "./index.js";
import {
  expectScreened,
  RECOMMENDATIONS_CORPUS_CASE_FILES as CASE_FILES,
  RECOMMENDATIONS_CORPUS_CASES as CASES,
  type ScreeningCase,
  uniqueSorted,
} from "./test-support.js";

function screenCase(testCase: ScreeningCase) {
  return expectScreened(
    screenSubject({
      subject: testCase.input.subject as ScreeningSubjectInput,
      members: testCase.input.members as readonly ScreenedMember[],
    }),
  );
}

describe("recommendations screening corpus", () => {
  it("mirrors every fixture file on disk", () => {
    expect(CASES.map((c) => c.caseId)).toEqual(CASE_FILES.map((f) => f.replace(/\.json$/, "")));
    expect(CASES.length).toBeGreaterThanOrEqual(10);
  });

  it("spans every required category", () => {
    expect(uniqueSorted(CASES.map((c) => c.category))).toEqual([
      "adversarial",
      "allergen-violating",
      "missing-data",
      "valid",
    ]);
  });

  it("reaches all three verdicts across the corpus", () => {
    expect(uniqueSorted(CASES.map((c) => c.expect.verdict))).toEqual([
      "ALLOWED",
      "ALLOWED_WITH_UNKNOWNS",
      "BLOCKED",
    ]);
  });

  it("documents why every case exists", () => {
    for (const testCase of CASES) {
      expect(testCase.title.length).toBeGreaterThan(0);
      expect(testCase.notes.length).toBeGreaterThan(0);
    }
  });

  for (const testCase of CASES) {
    it(`${testCase.caseId}: ${testCase.title}`, () => {
      const result = screenCase(testCase);

      expect(result.verdict).toBe(testCase.expect.verdict);

      for (const [memberId, verdict] of Object.entries(testCase.expect.memberVerdicts)) {
        const member = result.members.find((m) => m.memberId === memberId);
        expect(member, `no result for member ${memberId}`).toBeDefined();
        expect(member?.verdict, `member ${memberId}`).toBe(verdict);
      }

      const actualOutcomes: Record<string, string> = {};
      for (const member of result.members) {
        for (const restriction of member.restrictions) {
          actualOutcomes[restriction.restrictionId] = restriction.outcome;
        }
      }
      expect(actualOutcomes).toEqual(testCase.expect.outcomes);

      expect(uniqueSorted(result.evidence.map((e) => e.kind))).toEqual(
        uniqueSorted(testCase.expect.evidenceKinds),
      );
      expect(uniqueSorted(result.unknowns.map((u) => u.reason))).toEqual(
        uniqueSorted(testCase.expect.unknownReasons),
      );
      expect(uniqueSorted(result.warnings.map((w) => w.code))).toEqual(
        uniqueSorted(testCase.expect.warningCodes),
      );
    });
  }

  it("explains every BLOCKED verdict and never omits the standing caveat", () => {
    for (const testCase of CASES) {
      const result = screenCase(testCase);
      if (result.verdict === "BLOCKED") {
        expect(result.evidence.length, testCase.caseId).toBeGreaterThan(0);
      }
      if (result.verdict === "ALLOWED_WITH_UNKNOWNS") {
        const explained =
          result.unknowns.length > 0 ||
          result.warnings.some(
            (w) => w.code === "CROSS_CONTACT" || w.code === "CROSS_CONTACT_SEVERE",
          );
        expect(explained, testCase.caseId).toBe(true);
      }
      expect(result.warnings.map((w) => w.code)).toContain("NO_SAFETY_GUARANTEE");
    }
  });
});

/**
 * Allergen codes appearing in `tests/fixtures/products/**` (the M1-T5 corpus),
 * enumerated by inspecting every fixture file while writing this ticket. The
 * taxonomy adopted these exact spellings rather than introducing a translation
 * layer, so each must fold onto itself.
 *
 * `sesame` was absent from that corpus at M1-T4 time — a corpus gap (no
 * sesame-bearing product existed yet), not a naming divergence (tracked in
 * the M1-T4 handoff report) — and is filled by `condiment-102` (M1-T10-j,
 * Stone-Ground Tahini), so all nine major allergen codes are now exercised.
 */
const PRODUCT_CORPUS_CODES: readonly string[] = [
  "egg",
  "fish",
  "milk",
  "peanut",
  "sesame",
  "shellfish",
  "soy",
  "tree_nut",
  "wheat",
];

describe("taxonomy alignment with the M1-T5 product corpus", () => {
  it("folds every product-corpus code onto itself, with no renaming", () => {
    for (const code of PRODUCT_CORPUS_CODES) {
      expect(normalizeAllergenCode(code), `product-corpus code ${code}`).toBe(code);
    }
  });

  it("covers all nine major allergen codes, with no renaming", () => {
    expect([...PRODUCT_CORPUS_CODES].sort()).toEqual([...MAJOR_ALLERGEN_CODES].sort());
    expect(PRODUCT_CORPUS_CODES.length).toBe(MAJOR_ALLERGEN_CODES.length);
  });
});
