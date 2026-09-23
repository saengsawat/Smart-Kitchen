/**
 * Product-contracts consistency check (M3-T4b).
 *
 * `packages/contracts/src/products.ts` hand-writes `ProductCodeTypeDto`
 * rather than importing `packages/adapters/src/product-lookup/types.ts`'s
 * `CodeType` — that type is adapter-owned, not domain-owned, but the same
 * "contracts stays dependency-free" rule applies (an adapter that wants to
 * add a code type must not need to touch `packages/contracts` blindly).
 * `CodeType` is a type-only union with no backing runtime array (same
 * situation as the allergen unions), so this is the same compile-time
 * exhaustiveness proof `allergens-contracts-consistency.test.ts` uses.
 */

import { describe, expect, it } from "vitest";
import type { CodeType } from "@smart-kitchen/adapters";
import type { ProductCodeTypeDto } from "@smart-kitchen/contracts";

function assertNever(x: never): never {
  throw new Error(`products-contracts-consistency: unhandled adapter value ${JSON.stringify(x)}`);
}

function codeTypeToDto(c: CodeType): ProductCodeTypeDto {
  switch (c) {
    case "GTIN13":
      return "GTIN13";
    case "UPC_A":
      return "UPC_A";
    case "EAN13":
      return "EAN13";
    case "EAN8":
      return "EAN8";
    case "PLU":
      return "PLU";
    default:
      return assertNever(c);
  }
}

describe("product contracts vs adapters product-lookup CodeType (compile-time exhaustiveness)", () => {
  it("codeTypeToDto covers every CodeType member", () => {
    const codes: readonly CodeType[] = ["GTIN13", "UPC_A", "EAN13", "EAN8", "PLU"];
    for (const code of codes) {
      expect(codeTypeToDto(code)).toBe(code);
    }
  });
});
