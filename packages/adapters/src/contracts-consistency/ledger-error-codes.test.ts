/**
 * Ledger error-code consistency check (M2-T2).
 *
 * `packages/contracts/src/errors.ts` hand-writes `LEDGER_ERROR_CODES_DTO`
 * instead of importing the domain's `LedgerErrorCode`, for the same reason
 * `inventory-contracts-consistency.test.ts` gives for the transaction-type
 * list: contracts must stay dependency-free so `apps/mobile` can depend on it
 * without pulling `@smart-kitchen/domain` into the client bundle. This suite
 * is what stops the copy of the list drifting from the original.
 *
 * It closes the gap from both directions and in both worlds:
 *
 * - **Compile time.** `AssertNever` fails the build if either union has a
 *   member the other lacks, which is the case a runtime test cannot see (the
 *   domain exports `LedgerErrorCode` as a type only, with no array to compare).
 * - **Run time.** `EVERY_DOMAIN_CODE` is typed `Record<LedgerErrorCode, true>`,
 *   so the compiler forces it to name every domain code exactly once, and its
 *   keys are then compared with the DTO list as values. A code added to the
 *   domain and forgotten here fails to compile; a code added here and not in
 *   the domain fails to compile; a code in one list but not the other fails the
 *   assertion.
 *
 * Why it matters beyond tidiness: copy-deck.md §8 assigns every
 * `LedgerErrorCode` either a user-facing sentence or the generic fallback, and
 * the API answers a refused write with the code alone (never the domain's
 * message). A code the client's map has never heard of therefore renders as
 * nothing at all.
 */

import { describe, expect, it } from "vitest";
import type { LedgerErrorCode } from "@smart-kitchen/domain";
import { LEDGER_ERROR_CODES_DTO, type LedgerErrorCodeDto } from "@smart-kitchen/contracts";

/** Compiles only for `never`; any leftover union member is a compile error. */
type AssertNever<T extends never> = T;

/**
 * Both directions of the union difference, as values so they are read by a
 * test rather than sitting as dead type aliases. A code on one side and not
 * the other stops `AssertNever` resolving and the build fails here.
 */
const codesTheDtoHasAndTheDomainDoesNot: AssertNever<
  Exclude<LedgerErrorCodeDto, LedgerErrorCode>
>[] = [];
const codesTheDomainHasAndTheDtoDoesNot: AssertNever<
  Exclude<LedgerErrorCode, LedgerErrorCodeDto>
>[] = [];

/**
 * Exhaustive by construction: the `Record` type makes a missing key and an
 * unknown key both compile errors, which is what turns this object into a
 * runtime witness of the domain union.
 */
const EVERY_DOMAIN_CODE: Readonly<Record<LedgerErrorCode, true>> = {
  MIXED_UNITS: true,
  UNKNOWN_LOT: true,
  DUPLICATE_LOT: true,
  ZERO_DELTA: true,
  WRONG_SIGN: true,
  NOT_FINITE: true,
  PRECISION_EXCEEDED: true,
  QUANTITY_OUT_OF_RANGE: true,
  INVALID_TIMESTAMP: true,
  TIMESTAMP_ORDER: true,
  INVALID_IDEMPOTENCY_KEY: true,
  IDEMPOTENCY_KEY_CONFLICT: true,
  INVALID_FIELD: true,
  ITEM_MISMATCH: true,
  CORRUPT_LEDGER: true,
};

describe("contracts LEDGER_ERROR_CODES_DTO vs the domain's LedgerErrorCode", () => {
  it("has no code on one side that is missing from the other (compile time)", () => {
    // These arrays can only be typed at all when both differences are `never`;
    // the assertion is here so the check is a test result, not a silent build.
    expect(codesTheDtoHasAndTheDomainDoesNot).toEqual([]);
    expect(codesTheDomainHasAndTheDtoDoesNot).toEqual([]);
  });

  it("lists exactly the domain's codes, no more and no fewer", () => {
    expect([...LEDGER_ERROR_CODES_DTO].sort()).toEqual(Object.keys(EVERY_DOMAIN_CODE).sort());
  });

  it("has no duplicate entries", () => {
    expect(new Set(LEDGER_ERROR_CODES_DTO).size).toBe(LEDGER_ERROR_CODES_DTO.length);
  });

  it("covers the seven codes copy-deck.md §8 classifies as user-facing", () => {
    // These are the codes a person can reach through a normal action, so each
    // one has its own sentence in the deck. If the domain ever renames one,
    // this list is where the rename must be noticed and the deck updated.
    const userFacing = [
      "ZERO_DELTA",
      "WRONG_SIGN",
      "QUANTITY_OUT_OF_RANGE",
      "PRECISION_EXCEEDED",
      "INVALID_TIMESTAMP",
      "TIMESTAMP_ORDER",
      "UNKNOWN_LOT",
    ];
    for (const code of userFacing) {
      expect(LEDGER_ERROR_CODES_DTO).toContain(code);
    }
  });
});
