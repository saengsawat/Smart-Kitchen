/**
 * Household-contracts consistency check (M3-T2).
 *
 * `packages/contracts/src/household.ts` hand-writes `MAJOR_ALLERGEN_CODES_DTO`
 * (and its labels) rather than importing `packages/domain/src/allergens/
 * taxonomy.ts`, because contracts must stay dependency-free so `apps/mobile`
 * can depend on it without pulling `@smart-kitchen/domain` into the client
 * bundle (M3-T1 invariant; see household.ts's own doc comment). That leaves
 * the two lists free to drift silently.
 *
 * This suite lives here, not in `packages/contracts` or `packages/domain`,
 * because `packages/adapters` is the one package allowed to depend on both
 * (its package.json already lists `@smart-kitchen/contracts` and
 * `@smart-kitchen/domain`) — the same reasoning as
 * `product-lookup/recommendations-corpus-consistency.test.ts`'s placement.
 */

import { describe, expect, it } from "vitest";
import { MAJOR_ALLERGEN_CODES, MAJOR_ALLERGEN_LABELS } from "@smart-kitchen/domain";
import { MAJOR_ALLERGEN_CODES_DTO, MAJOR_ALLERGEN_LABELS_DTO } from "@smart-kitchen/contracts";

describe("household contracts vs domain allergen taxonomy", () => {
  it("MAJOR_ALLERGEN_CODES_DTO equals the domain's MAJOR_ALLERGEN_CODES, in the same order", () => {
    expect(MAJOR_ALLERGEN_CODES_DTO).toEqual(MAJOR_ALLERGEN_CODES);
  });

  it("MAJOR_ALLERGEN_LABELS_DTO equals the domain's MAJOR_ALLERGEN_LABELS for every code", () => {
    for (const code of MAJOR_ALLERGEN_CODES) {
      expect(MAJOR_ALLERGEN_LABELS_DTO[code]).toBe(MAJOR_ALLERGEN_LABELS[code]);
    }
  });

  it("neither list has a code the other lacks", () => {
    expect(new Set(MAJOR_ALLERGEN_CODES_DTO)).toEqual(new Set(MAJOR_ALLERGEN_CODES));
  });
});
