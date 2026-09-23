/**
 * Household-facing unit contracts (M3-T4b).
 *
 * Hand-written mirror of `packages/domain/src/units/registry.ts`'s
 * `UNIT_KINDS`/`UNIT_ENTRIES`, restricted to the units S9's manual-add unit
 * picker offers (BACKLOG.md M3-T4b Objective (f)):
 * `packages/adapters/src/contracts-consistency/units-contracts-consistency.test.ts`
 * proves every symbol below resolves in the domain registry to the kind
 * claimed here.
 *
 * **Deviation from the ticket text, flagged as an ARCHITECTURE CONFLICT in
 * `docs/handoff/M3-T4b.worker.md`:** the ticket's volume list names `fl oz`
 * (matching prototype v4's `UNIT_OPTIONS.volume`), but the domain registry
 * documents fluid ounces as *intentionally unsupported* (registry.ts's own
 * doc comment: "adding a second, differently-valued `oz` would make unit
 * lookup ambiguous, which is exactly the kind of guess this module must
 * never make") — a domain invariant, not an oversight, and already tracked as
 * an open follow-up ("fl-oz disambiguation guard if fluid ounces ever
 * needed", M1-T3 accepted follow-ups in BACKLOG.md). Adding `fl oz` here
 * would either (a) ship a unit the ledger cannot convert or record, or (b)
 * require a domain-registry change outside this ticket's file scope. Neither
 * is available to a worker mid-ticket (CLAUDE.md rule 25), so `fl oz` is
 * omitted from {@link UNITS_BY_KIND_DTO}'s volume list; the worker report
 * recommends the architect resolve it (add `fl oz` to the registry with its
 * own disambiguation guard, or accept the omission for MVP) before S9 is
 * asked to offer it.
 */

/** Mirrors domain's `UNIT_KINDS`. */
export const UNIT_KINDS_DTO = ["MASS", "VOLUME", "COUNT"] as const;
export type UnitKindDto = (typeof UNIT_KINDS_DTO)[number];

/**
 * Household-facing unit symbols per kind, a strict subset of domain's
 * `UNIT_ENTRIES` (every symbol here resolves via the domain's `lookupUnit`,
 * proved at the consistency-test level, not merely asserted here). `"each"`
 * is an alias of the registry's canonical `"count"` entry (registry.ts:
 * `COUNT_UNITS[0].aliases` includes `"each"`), chosen because it is the word
 * the prototype and copy-deck use for a single countable item; the ledger
 * accepts it as a synonym without a second registry entry.
 */
export const UNITS_BY_KIND_DTO: Readonly<Record<UnitKindDto, readonly string[]>> = Object.freeze({
  MASS: ["g", "kg", "oz", "lb"],
  // "fl oz" omitted — see module doc comment.
  VOLUME: ["ml", "l", "tsp", "tbsp", "cup"],
  COUNT: ["each"],
});
