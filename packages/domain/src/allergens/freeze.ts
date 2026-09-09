/**
 * Runtime immutability guard for screening results.
 *
 * `readonly` is erased at compile time, so the engine deep-freezes every
 * result it hands back: a verdict is a safety decision, and a caller must not
 * be able to edit `verdict: "BLOCKED"` into `"ALLOWED"` on the returned object
 * (package is ESM ⇒ always strict mode ⇒ such a write throws `TypeError`
 * rather than silently succeeding).
 *
 * Deliberately duplicated from `inventory/freeze.ts` rather than imported: the
 * allergen module is self-contained by the same architect guidance that keeps
 * `units/**` free of ledger imports (M1-T3, OQ-2) — allergen screening has no
 * business depending on the inventory ledger. Extracting a shared
 * `domain/src/shared/` helper is a proposed follow-up, not this ticket's call.
 */

/**
 * Recursively freezes plain objects and arrays. Primitives pass through
 * untouched. The `seen` guard keeps the function total even if a caller ever
 * hands in a cyclic structure.
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

/** True when `value` is frozen all the way down (used by the immutability tests). */
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
