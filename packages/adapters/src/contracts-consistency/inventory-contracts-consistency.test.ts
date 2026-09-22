/**
 * Inventory-contracts consistency check (M3-T3).
 *
 * `packages/contracts/src/inventory.ts` hand-writes `TRANSACTION_TYPES_DTO`
 * rather than importing `packages/domain/src/inventory/types.ts`'s
 * `TRANSACTION_TYPES`, for the same reason `household-contracts-consistency
 * .test.ts` hand-writes the allergen code list: contracts must stay
 * dependency-free so `apps/mobile` can depend on it without pulling
 * `@smart-kitchen/domain` into the client bundle (M3-T1 invariant). That
 * leaves the two lists free to drift silently, which is exactly what the
 * ticket asks this suite to close: "a consistency test in packages/adapters
 * proving the DTO transaction type list equals TRANSACTION_TYPES."
 *
 * Lives here, not in `packages/contracts` or `packages/domain`, because
 * `packages/adapters` is the one package allowed to depend on both — same
 * placement reasoning as `household-contracts-consistency.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { TRANSACTION_TYPES } from "@smart-kitchen/domain";
import { TRANSACTION_TYPES_DTO } from "@smart-kitchen/contracts";

describe("inventory contracts vs domain transaction types", () => {
  it("TRANSACTION_TYPES_DTO equals the domain's TRANSACTION_TYPES, in the same order", () => {
    expect(TRANSACTION_TYPES_DTO).toEqual(TRANSACTION_TYPES);
  });

  it("neither list has a member the other lacks", () => {
    expect(new Set(TRANSACTION_TYPES_DTO)).toEqual(new Set(TRANSACTION_TYPES));
  });
});
