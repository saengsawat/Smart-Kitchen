/**
 * Builders shared by the inventory ledger tests.
 *
 * This file lives in `src/` (rather than a test-only directory) so it stays
 * inside the package's tsconfig and under the same strict settings as the code
 * it exercises. It is deliberately dependency-free — no vitest, no fast-check —
 * so the domain dependency-boundary lint applies to it unchanged, and it is not
 * re-exported from the package's public API.
 */

import type {
  Actor,
  CreateInventoryItemInput,
  Provenance,
  TransactionInput,
  TransactionType,
} from "./types.js";
import { transactionDirection } from "./types.js";

export const TEST_HOUSEHOLD = "hh-001";
export const TEST_ITEM = "item-chicken-breast";
export const TEST_LOT = "lot-1";
export const TEST_UNIT = "lb";

export const TEST_USER: Actor = { kind: "user", userId: "user-dean" };

export const MANUAL_PROVENANCE: Provenance = {
  tier: "KNOWN_FACT",
  source: "manual-entry",
};

/** Base epoch for generated timestamps: 2026-03-06T18:00:00.000Z. */
export const BASE_EPOCH_MS = Date.UTC(2026, 2, 6, 18, 0, 0);

/** Deterministic ISO instant, `step` seconds after {@link BASE_EPOCH_MS}. */
export function instantAt(step: number): string {
  return new Date(BASE_EPOCH_MS + step * 1000).toISOString();
}

export function itemInput(
  overrides: Partial<CreateInventoryItemInput> = {},
): CreateInventoryItemInput {
  return {
    itemId: TEST_ITEM,
    householdId: TEST_HOUSEHOLD,
    unit: TEST_UNIT,
    lots: [{ lotId: TEST_LOT }],
    ...overrides,
  };
}

/**
 * A valid transaction input with the sign implied by its type, so tests only
 * state what they care about. Pass a signed `qtyDelta` to override.
 */
export function txInput(
  type: TransactionType,
  magnitude: number,
  overrides: Partial<TransactionInput> = {},
): TransactionInput {
  const direction = transactionDirection(type);
  const signed = direction === "decrease" ? -Math.abs(magnitude) : magnitude;
  return {
    lotId: TEST_LOT,
    type,
    qtyDelta: signed,
    unit: TEST_UNIT,
    actor: TEST_USER,
    occurredAt: instantAt(0),
    recordedAt: instantAt(1),
    provenance: MANUAL_PROVENANCE,
    idempotencyKey: `${type.toLowerCase()}-${String(magnitude)}`,
    ...overrides,
  };
}

/**
 * JSON with `bigint` support — used to prove recorded rows are byte-identical
 * before and after later appends (INV-LEDGER-2).
 */
export function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? `${item.toString()}n` : item,
  );
}
