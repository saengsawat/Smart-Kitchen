/**
 * Unit-contracts consistency check (M3-T4b).
 *
 * `packages/contracts/src/units.ts` hand-writes `UNIT_KINDS_DTO` and
 * `UNITS_BY_KIND_DTO` rather than importing `packages/domain/src/units/
 * registry.ts`, for the same "contracts stays dependency-free" reason as
 * every other mirrored list in this package. Unlike the allergen unions
 * (compile-time only, see `allergens-contracts-consistency.test.ts`), the
 * domain's unit registry is a real runtime table (`UNIT_KINDS`,
 * `UNIT_ENTRIES`, `lookupUnit`), so this suite proves the mirror against it
 * directly, at runtime: every symbol {@link UNITS_BY_KIND_DTO} claims for a
 * kind actually resolves in the domain registry to that same kind.
 */

import { describe, expect, it } from "vitest";
import { lookupUnit, UNIT_KINDS } from "@smart-kitchen/domain";
import { UNIT_KINDS_DTO, UNITS_BY_KIND_DTO } from "@smart-kitchen/contracts";

describe("unit contracts vs domain unit registry", () => {
  it("UNIT_KINDS_DTO equals the domain's UNIT_KINDS, in the same order", () => {
    expect(UNIT_KINDS_DTO).toEqual(UNIT_KINDS);
  });

  it("neither list has a kind the other lacks", () => {
    expect(new Set(UNIT_KINDS_DTO)).toEqual(new Set(UNIT_KINDS));
  });

  it("every restricted unit symbol resolves in the domain registry to its claimed kind", () => {
    for (const kind of UNIT_KINDS_DTO) {
      for (const symbol of UNITS_BY_KIND_DTO[kind]) {
        const resolved = lookupUnit(symbol);
        expect(resolved.ok, `lookupUnit(${symbol}) should resolve`).toBe(true);
        if (resolved.ok) {
          expect(resolved.value.kind).toBe(kind);
        }
      }
    }
  });

  it("every restricted list has at least one unit", () => {
    for (const kind of UNIT_KINDS_DTO) {
      expect(UNITS_BY_KIND_DTO[kind].length).toBeGreaterThan(0);
    }
  });
});
