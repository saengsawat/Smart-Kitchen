/**
 * COUNT alias consistency (M9-T2).
 *
 * `COUNT_UNIT_ALIASES_DTO` in `packages/contracts/src/units.ts` is the list
 * `apps/mobile` uses for the D-029 whole-number check. It must equal the
 * domain registry's COUNT spellings in both directions. This package imports
 * both contracts and domain, so the proof lives here.
 */

import { describe, expect, it } from "vitest";
import { UNIT_ENTRIES } from "@smart-kitchen/domain";
import { COUNT_UNIT_ALIASES_DTO } from "@smart-kitchen/contracts";

const registryCountSpellings = new Set(
  UNIT_ENTRIES.filter((entry) => entry.kind === "COUNT").flatMap((entry) => [
    entry.symbol,
    ...entry.aliases,
  ]),
);

describe("COUNT_UNIT_ALIASES_DTO vs domain registry COUNT spellings", () => {
  it("has no spelling the registry lacks", () => {
    const extra = COUNT_UNIT_ALIASES_DTO.filter((a) => !registryCountSpellings.has(a));
    expect(extra).toEqual([]);
  });

  it("lacks no spelling the registry files under COUNT", () => {
    const missing = [...registryCountSpellings].filter((a) => !COUNT_UNIT_ALIASES_DTO.includes(a));
    expect(missing).toEqual([]);
  });

  it("has no duplicates and is frozen", () => {
    expect(new Set(COUNT_UNIT_ALIASES_DTO).size).toBe(COUNT_UNIT_ALIASES_DTO.length);
    expect(Object.isFrozen(COUNT_UNIT_ALIASES_DTO)).toBe(true);
  });
});
