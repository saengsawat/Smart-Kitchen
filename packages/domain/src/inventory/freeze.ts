/**
 * Runtime immutability guard for INV-LEDGER-2.
 *
 * `readonly` is erased at compile time, so the ledger additionally deep-freezes
 * every aggregate it hands back. Because this package is ESM (always strict
 * mode), an attempt to write to a recorded transaction throws `TypeError`
 * rather than silently succeeding — a corrupted ledger fails loudly and at the
 * point of the bug.
 */

/**
 * Recursively freezes plain objects and arrays. Primitives (including `bigint`)
 * pass through untouched. Cycles are impossible in ledger data, and the
 * `seen` guard keeps the function total anyway.
 */
export function deepFreeze<T>(value: T, seen: Set<object> = new Set()): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  const asObject = value as unknown as object;
  if (seen.has(asObject)) return value;
  seen.add(asObject);

  for (const child of Object.values(asObject as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  Object.freeze(asObject);
  return value;
}

/** True when `value` is frozen (used by the immutability tests). */
export function isDeeplyFrozen(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return true;
  }
  const asObject: object = value;
  if (seen.has(asObject)) return true;
  seen.add(asObject);
  if (!Object.isFrozen(asObject)) return false;
  return Object.values(asObject as Record<string, unknown>).every((child) =>
    isDeeplyFrozen(child, seen),
  );
}
