/**
 * Lot-selection policy for consumption — the FEFO/FIFO planner (M1-T8, ADR-008).
 *
 * `appendTransaction` requires a `lotId`: it records where stock left from, it
 * does not decide it. This module is that decision, and nothing else. It is a
 * *planner*: it reads an aggregate and returns a plan; it never writes, never
 * mutates, has no clock, no randomness and no I/O, so the same aggregate and the
 * same request always produce the same plan.
 *
 * Two guarantees shape the whole module:
 *
 * 1. **A plan can never cause an `OVER_CONSUMPTION` clamp (INV-LEDGER-4).**
 *    Every allocation is capped at that lot's *derived* balance, so applying the
 *    plan through {@link appendTransactions} adds only the rows the caller asked
 *    for. A request larger than the stock on hand drains what exists and reports
 *    the rest as {@link ConsumptionPlan.shortfallMicros} — the planner never
 *    invents stock and never emits a positive or zero allocation. What to do
 *    with a shortfall (record it anyway and accept the clamp, warn, or stop) is
 *    the caller's decision, deliberately: only the caller knows whether the user
 *    is asserting a fact about the world or requesting a withdrawal.
 *
 * 2. **Balances come from the ledger, not the snapshot.** Lot balances are
 *    re-derived from the transactions (`sumLotDeltaMicros`). If a snapshot
 *    disagrees with its rows — or any other {@link reconcile} check fails — the
 *    planner refuses with that error instead of planning on either number. A
 *    consumption plan built on a corrupt aggregate would move real food.
 */

import { reconcile, sumLotDeltaMicros } from "./derive.js";
import { err, ok, type LedgerError, type Outcome } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { RESERVED_KEY_SEPARATOR } from "./ledger.js";
import { amountToMicros, microsToAmount, MAX_QUANTITY_MICROS } from "./quantity.js";
import {
  transactionDirection,
  TRANSACTION_TYPES,
  type Actor,
  type CorrelationRef,
  type Instant,
  type InventoryItem,
  type InventoryLot,
  type Provenance,
  type ProvenanceTier,
  type TransactionInput,
} from "./types.js";

/**
 * Which lot a consumption draws from first.
 *
 * - `FEFO` — *first expired, first out*: soonest `expiresAt` first, so the stock
 *   closest to being wasted is used first. Undated lots go last (an unknown
 *   expiry is not evidence of a distant one, but a dated lot carries an
 *   actionable deadline and an undated one does not).
 * - `FIFO` — *first in, first out*: oldest `acquiredAt` first. Used where expiry
 *   is unknown or meaningless, and for stock rotation.
 *
 * Which of the two the product *defaults* to is domain-model.md OQ-1 and is not
 * decided here; both are implemented and the caller states the policy.
 */
export type LotSelectionPolicy = "FEFO" | "FIFO";

/** Every known policy, for validation and exhaustive tests. */
export const LOT_SELECTION_POLICIES = ["FEFO", "FIFO"] as const;

/**
 * Infix of a derived per-lot idempotency key: `<base>/lot/<index>`.
 *
 * The ledger reserves `::` for rows it authors itself, so a derived key must not
 * use it (`appendTransaction` would reject the whole batch). This infix is the
 * planner's own namespace instead, and {@link consumptionInputsFromPlan} rejects
 * a base key that already contains it. That rejection is what makes the mapping
 * `(baseKey, index) -> derivedKey` injective: with `/lot/` absent from every
 * accepted base key, the first occurrence of `/lot/` in a derived key always
 * delimits the base, so two different bases can never derive the same key, and
 * within one plan the allocation index keeps them distinct.
 */
export const PLAN_KEY_INFIX = "/lot/";

/** One lot's share of a planned consumption. */
export interface LotAllocation {
  readonly lotId: string;
  /** Negative — the delta to record against this lot. Never 0, never positive. */
  readonly qtyDeltaMicros: bigint;
  /** The lot's ledger-derived balance before the plan is applied; always > 0. */
  readonly lotBalanceBeforeMicros: bigint;
  readonly expiresAt?: Instant;
  readonly expiryTier?: ProvenanceTier;
  readonly acquiredAt?: Instant;
}

/** Why a lot contributed nothing to the plan. */
export type SkippedLotReason = "ZERO_BALANCE" | "NEGATIVE_BALANCE";

/**
 * A lot the planner passed over, reported rather than silently dropped so a
 * caller (or a log) can explain why a lot was not touched.
 */
export interface SkippedLot {
  readonly lotId: string;
  readonly balanceMicros: bigint;
  readonly reason: SkippedLotReason;
}

/**
 * A deterministic, deep-frozen plan for splitting one decrease across lots.
 *
 * `allocatedMicros + shortfallMicros === requestedMicros` always holds, and
 * `allocatedMicros` is exactly `Σ |allocation.qtyDeltaMicros|`.
 */
export interface ConsumptionPlan {
  readonly policy: LotSelectionPolicy;
  /** Positive magnitude that was asked for. */
  readonly requestedMicros: bigint;
  /** Positive magnitude the lots can actually cover (0 when nothing is on hand). */
  readonly allocatedMicros: bigint;
  /** Positive magnitude that could not be covered; 0 when the request was met. */
  readonly shortfallMicros: bigint;
  /** In policy order; one entry per contributing lot, each with a negative delta. */
  readonly allocations: readonly LotAllocation[];
  /** Lots that were passed over, in `item.lots` order. */
  readonly skippedLots: readonly SkippedLot[];
}

/**
 * How much to consume, stated either exactly (`qtyMicros`) or as a decimal
 * `amount` in the item's unit, plus the policy to select lots with.
 *
 * There is no `asOf`: expiry ordering needs no clock (an expired lot is simply
 * the earliest `expiresAt`, and *whether* to consume expired stock is a caller
 * decision, not a selection rule), and the domain has no clock to offer.
 */
export type ConsumptionRequest = {
  readonly policy: LotSelectionPolicy;
} & (
  | { readonly qtyMicros: bigint; readonly amount?: undefined }
  | { readonly amount: number; readonly qtyMicros?: undefined }
);

/** Everything a derived {@link TransactionInput} needs except the per-lot parts. */
export type ConsumptionInputBase = Omit<TransactionInput, "lotId" | "qtyDelta">;

/**
 * ISO-8601 instant shape accepted for lot dates.
 *
 * Deliberately the same expression the ledger validates timestamps with. It is
 * duplicated rather than imported because `ledger.ts` does not export it and
 * this ticket's file scope does not include changing that module; sharing the
 * parser is a proposed follow-up in the M1-T8 worker report.
 */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parses an optional lot instant to epoch millis.
 *
 * Returns `undefined` for an absent date (legitimately undated — ordered last)
 * and a typed error for a present but unparseable one. Ordering must never fall
 * back to `NaN`, which compares false against everything and would make the sort
 * order depend on the input order.
 *
 * **Millisecond resolution.** `Date.parse` truncates below the millisecond, so
 * two instants differing only in their sub-millisecond digits (the ledger's
 * regex accepts up to 9 fractional digits) compare *equal* here and the tie is
 * resolved by the next ordering key — `acquiredAt`, then the lot's position.
 * That is deliberate: lot dates are shelf-life facts, where sub-millisecond
 * ordering carries no product meaning, and the fallback keys keep the order
 * total either way.
 */
function optionalMillis(
  value: Instant | undefined,
  field: string,
  lotId: string,
): Outcome<number | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "string" || !ISO_INSTANT_RE.test(value)) {
    return err("INVALID_TIMESTAMP", `lot ${lotId}: ${field} must be an ISO-8601 instant`, lotId);
  }
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    return err("INVALID_TIMESTAMP", `lot ${lotId}: ${field} is not a valid instant`, lotId);
  }
  return ok(millis);
}

/** A lot with everything the ordering needs, resolved once. */
interface Candidate {
  readonly lot: InventoryLot;
  /** Position in `item.lots` — the final, always-present tie-break. */
  readonly order: number;
  readonly balanceMicros: bigint;
  readonly expiresAtMillis: number | undefined;
  readonly acquiredAtMillis: number | undefined;
}

/** Ascending comparison where an absent date sorts **last**, never `NaN`. */
function compareOptionalMillis(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * Total order over candidate lots for a policy.
 *
 * Every comparator ends in `order`, so the result is a total order on distinct
 * lots and does not depend on the sort implementation's stability.
 */
function compareCandidates(policy: LotSelectionPolicy, left: Candidate, right: Candidate): number {
  if (policy === "FEFO") {
    const byExpiry = compareOptionalMillis(left.expiresAtMillis, right.expiresAtMillis);
    if (byExpiry !== 0) return byExpiry;
  }
  const byAcquired = compareOptionalMillis(left.acquiredAtMillis, right.acquiredAtMillis);
  if (byAcquired !== 0) return byAcquired;
  return left.order - right.order;
}

/** Builds an allocation, carrying only the lot metadata a caller needs to explain it. */
function buildAllocation(candidate: Candidate, takeMicros: bigint): LotAllocation {
  const allocation: LotAllocation = {
    lotId: candidate.lot.lotId,
    qtyDeltaMicros: -takeMicros,
    lotBalanceBeforeMicros: candidate.balanceMicros,
  };
  return {
    ...allocation,
    ...(candidate.lot.expiresAt === undefined ? {} : { expiresAt: candidate.lot.expiresAt }),
    ...(candidate.lot.expiryTier === undefined ? {} : { expiryTier: candidate.lot.expiryTier }),
    ...(candidate.lot.acquiredAt === undefined ? {} : { acquiredAt: candidate.lot.acquiredAt }),
  };
}

/** Structural guard so the module stays total on untrusted-shaped input. */
function validateItemShape(item: InventoryItem): LedgerError | null {
  if (typeof item !== "object" || item === null) {
    return { code: "INVALID_FIELD", message: "item is required", field: "item" };
  }
  if (!Array.isArray(item.lots) || !Array.isArray(item.transactions)) {
    return {
      code: "INVALID_FIELD",
      message: "item.lots and item.transactions must be arrays",
      field: "item",
    };
  }
  return null;
}

/**
 * Resolves the requested magnitude to exact micro-units, or explains why it cannot.
 *
 * Each field is read **exactly once** into a local and every check then runs on
 * that local (M1-T6 review F1). Re-reading a property of untrusted input is a
 * time-of-check/time-of-use bug: a getter (or a Proxy) that returns a `bigint`
 * to the type check and a `number` to the arithmetic would otherwise produce a
 * plan whose quantities are not the ones that were validated.
 */
function requestedMicrosOf(request: ConsumptionRequest): Outcome<bigint> {
  const qtyMicros: unknown = request.qtyMicros;
  const amount: unknown = request.amount;
  const hasMicros = qtyMicros !== undefined;
  const hasAmount = amount !== undefined;
  if (hasMicros === hasAmount) {
    return err(
      "INVALID_FIELD",
      "state the quantity as exactly one of qtyMicros or amount",
      "request",
    );
  }

  let micros: bigint;
  if (hasAmount) {
    if (typeof amount !== "number") {
      return err("NOT_FINITE", "amount must be a finite number", "amount");
    }
    const converted = amountToMicros(amount, "amount");
    if (!converted.ok) return converted;
    micros = converted.value;
  } else if (typeof qtyMicros === "bigint") {
    micros = qtyMicros;
  } else {
    return err("INVALID_FIELD", "qtyMicros must be a bigint", "qtyMicros");
  }

  if (micros === 0n) {
    return err("ZERO_DELTA", "a consumption request must be greater than zero", "qtyMicros");
  }
  if (micros < 0n) {
    return err(
      "WRONG_SIGN",
      "a consumption request is stated as a positive magnitude; the plan carries the negative deltas",
      "qtyMicros",
    );
  }
  // Each allocation is at most the whole request, so capping the request here is
  // what keeps every derived `qtyDelta` inside the ledger's representable range.
  if (micros > MAX_QUANTITY_MICROS) {
    return err(
      "QUANTITY_OUT_OF_RANGE",
      "consumption request exceeds the representable ledger range",
      "qtyMicros",
    );
  }
  return ok(micros);
}

/**
 * Plans how a decrease is split across an item's lots.
 *
 * Refuses (never throws) when the item is corrupt, the policy is unknown, the
 * request is not a positive representable quantity, or a lot carries an
 * unparseable date. On success the plan is deep-frozen and the input aggregate
 * is untouched.
 */
export function planLotConsumption(
  item: InventoryItem,
  request: ConsumptionRequest,
): Outcome<ConsumptionPlan> {
  const shapeProblem = validateItemShape(item);
  if (shapeProblem !== null) return { ok: false, error: shapeProblem };

  if (typeof request !== "object" || request === null) {
    return err("INVALID_FIELD", "request is required", "request");
  }
  const policy = request.policy;
  if (!(LOT_SELECTION_POLICIES as readonly string[]).includes(policy)) {
    return err("INVALID_FIELD", `${String(policy)} is not a lot-selection policy`, "policy");
  }

  const requested = requestedMicrosOf(request);
  if (!requested.ok) return requested;

  // The aggregate must be internally consistent before any of its numbers are
  // used to move food: snapshot == Σ deltas at item and lot level, no negative
  // balance, every row attributable (see `reconcile`). A drifting snapshot is a
  // corruption report, not a number to plan with.
  const report = reconcile(item);
  if (!report.ok) {
    const first = report.problems[0];
    return {
      ok: false,
      error: first ?? { code: "CORRUPT_LEDGER", message: "item failed reconciliation" },
    };
  }

  const candidates: Candidate[] = [];
  const skippedLots: SkippedLot[] = [];
  const seenLotIds = new Set<string>();
  for (const [order, lot] of item.lots.entries()) {
    // Two lot entries sharing an id are not two lots: `sumLotDeltaMicros` sums
    // by id, so each copy would report the *same* balance and the planner would
    // allocate it twice — inventing stock, and clamping on apply. `reconcile`
    // does not catch this (it reports both copies consistently), and
    // `createInventoryItem`/`openLot` already refuse duplicates, so an aggregate
    // carrying one is malformed: refuse it rather than plan on it.
    if (seenLotIds.has(lot.lotId)) {
      return err("DUPLICATE_LOT", `lot ${lot.lotId} appears more than once on the item`, lot.lotId);
    }
    seenLotIds.add(lot.lotId);

    const expires = optionalMillis(lot.expiresAt, "expiresAt", lot.lotId);
    if (!expires.ok) return expires;
    const acquired = optionalMillis(lot.acquiredAt, "acquiredAt", lot.lotId);
    if (!acquired.ok) return acquired;

    // Derived from the rows, never read off `lot.currentQty` (see module header).
    const balanceMicros = sumLotDeltaMicros(item.transactions, lot.lotId);
    if (balanceMicros <= 0n) {
      // A negative balance cannot reach here — `reconcile` already refused the
      // aggregate — but classifying it keeps the skip honest if that guard ever
      // moves, and an empty lot is reported rather than silently dropped.
      skippedLots.push({
        lotId: lot.lotId,
        balanceMicros,
        reason: balanceMicros < 0n ? "NEGATIVE_BALANCE" : "ZERO_BALANCE",
      });
      continue;
    }
    candidates.push({
      lot,
      order,
      balanceMicros,
      expiresAtMillis: expires.value,
      acquiredAtMillis: acquired.value,
    });
  }

  candidates.sort((left, right) => compareCandidates(policy, left, right));

  const allocations: LotAllocation[] = [];
  let remaining = requested.value;
  for (const candidate of candidates) {
    if (remaining === 0n) break;
    // The cap that makes a clamp impossible: never more than the lot holds.
    const take = candidate.balanceMicros < remaining ? candidate.balanceMicros : remaining;
    allocations.push(buildAllocation(candidate, take));
    remaining -= take;
  }

  const plan: ConsumptionPlan = {
    policy,
    requestedMicros: requested.value,
    allocatedMicros: requested.value - remaining,
    shortfallMicros: remaining,
    allocations,
    skippedLots,
  };
  return ok(deepFreeze(plan));
}

/**
 * Rebuilds an actor as a fresh object, keeping only the declared fields of its
 * kind (the ledger's `buildRecorded` reasoning: never carry a caller's object,
 * and never let an unknown field ride along).
 */
function copyActor(actor: Actor): Outcome<Actor> {
  if (typeof actor !== "object" || actor === null) {
    return err("INVALID_FIELD", "actor is required", "actor");
  }
  switch (actor.kind) {
    case "user":
      return ok({ kind: "user", userId: actor.userId });
    case "system":
      return ok({ kind: "system", component: actor.component });
    case "ai-confirmed":
      return ok({ kind: "ai-confirmed", userId: actor.userId, modelRef: actor.modelRef });
    default:
      return err("INVALID_FIELD", "actor.kind is not a known actor kind", "actor.kind");
  }
}

/** Rebuilds provenance as a fresh object, keeping only declared fields. */
function copyProvenance(provenance: Provenance): Provenance {
  const copy: Provenance = { tier: provenance.tier, source: provenance.source };
  return {
    ...copy,
    ...(provenance.confidence === undefined ? {} : { confidence: provenance.confidence }),
    ...(provenance.modelRef === undefined ? {} : { modelRef: provenance.modelRef }),
    ...(provenance.observedAt === undefined ? {} : { observedAt: provenance.observedAt }),
    ...(provenance.confirmedBy === undefined ? {} : { confirmedBy: provenance.confirmedBy }),
  };
}

/** Rebuilds a correlation reference as a fresh object. */
function copyCorrelationRef(ref: CorrelationRef): CorrelationRef {
  return { kind: ref.kind, id: ref.id };
}

/** Validates the parts of the base input this module is responsible for. */
function validateBase(base: ConsumptionInputBase): LedgerError | null {
  if (typeof base !== "object" || base === null) {
    return { code: "INVALID_FIELD", message: "base input is required", field: "base" };
  }
  if (!(TRANSACTION_TYPES as readonly string[]).includes(base.type)) {
    return {
      code: "INVALID_FIELD",
      message: `${String(base.type)} is not a transaction type`,
      field: "type",
    };
  }
  // A plan describes stock leaving. `ADJUSTMENT` (signed) and the increase types
  // are not consumption: routing them through here would let a correction or a
  // purchase be split across lots by an expiry rule, which is meaningless, and —
  // for a signed `ADJUSTMENT` — would silently invert the plan's negative deltas
  // into a legal write.
  if (transactionDirection(base.type) !== "decrease") {
    return {
      code: "INVALID_FIELD",
      message: `${base.type} is not a consuming transaction type; a plan only describes stock leaving`,
      field: "type",
    };
  }
  if (typeof base.idempotencyKey !== "string" || base.idempotencyKey.trim() === "") {
    return {
      code: "INVALID_FIELD",
      message: "idempotencyKey must be a non-empty string",
      field: "idempotencyKey",
    };
  }
  if (base.idempotencyKey.includes(RESERVED_KEY_SEPARATOR)) {
    return {
      code: "INVALID_IDEMPOTENCY_KEY",
      message: `idempotencyKey may not contain the reserved separator "${RESERVED_KEY_SEPARATOR}"`,
      field: "idempotencyKey",
    };
  }
  if (base.idempotencyKey.includes(PLAN_KEY_INFIX)) {
    return {
      code: "INVALID_IDEMPOTENCY_KEY",
      message: `idempotencyKey may not contain "${PLAN_KEY_INFIX}", which derived per-lot keys reserve`,
      field: "idempotencyKey",
    };
  }
  if (typeof base.provenance !== "object" || base.provenance === null) {
    return { code: "INVALID_FIELD", message: "provenance is required", field: "provenance" };
  }
  return null;
}

/**
 * Array guard that keeps the element type.
 *
 * `Array.isArray` on a `readonly T[]` widens to `any[]`, which would erase the
 * allocation type for the rest of the function; this preserves it.
 */
function isAllocationArray(value: unknown): value is readonly LotAllocation[] {
  return Array.isArray(value);
}

/** Validates an allocation before it is turned into a ledger write. */
function validateAllocation(allocation: LotAllocation, index: number): LedgerError | null {
  const at = `allocations[${String(index)}]`;
  if (typeof allocation !== "object" || allocation === null) {
    return { code: "INVALID_FIELD", message: `${at} is missing`, field: at };
  }
  if (typeof allocation.lotId !== "string" || allocation.lotId.trim() === "") {
    return { code: "INVALID_FIELD", message: `${at}.lotId must be a non-empty string`, field: at };
  }
  if (typeof allocation.qtyDeltaMicros !== "bigint") {
    return { code: "INVALID_FIELD", message: `${at}.qtyDeltaMicros must be a bigint`, field: at };
  }
  if (allocation.qtyDeltaMicros === 0n) {
    return { code: "ZERO_DELTA", message: `${at} changes nothing`, field: at };
  }
  if (allocation.qtyDeltaMicros > 0n) {
    return {
      code: "WRONG_SIGN",
      message: `${at} must carry a negative delta (stock leaving)`,
      field: at,
    };
  }
  if (-allocation.qtyDeltaMicros > MAX_QUANTITY_MICROS) {
    return {
      code: "QUANTITY_OUT_OF_RANGE",
      message: `${at} exceeds the representable ledger range`,
      field: at,
    };
  }
  // The no-clamp guarantee, re-checked on the way out: a hand-built plan does
  // not get to overdraw a lot through this door. The balance is *required* — an
  // allocation that does not state what the lot held cannot be checked against
  // it, and an unchecked allocation is exactly the clamp this module exists to
  // make impossible.
  if (typeof allocation.lotBalanceBeforeMicros !== "bigint") {
    return {
      code: "INVALID_FIELD",
      message: `${at}.lotBalanceBeforeMicros must be a bigint`,
      field: at,
    };
  }
  if (-allocation.qtyDeltaMicros > allocation.lotBalanceBeforeMicros) {
    return {
      code: "WRONG_SIGN",
      message: `${at} takes more than the lot held; applying it would clamp`,
      field: at,
    };
  }
  return null;
}

/**
 * Turns a {@link ConsumptionPlan} into one ledger write per allocation.
 *
 * Fields are copied from `base` by **explicit list** — never by spreading the
 * caller's object — so nothing undeclared, and in particular nothing the ledger
 * treats as its own marker, can ride into a transaction input (the M1-T1 review
 * F1 finding, applied one layer earlier).
 *
 * Idempotency keys are derived as `<base.idempotencyKey>/lot/<index>`: stable
 * for a given plan, unique within it, and outside the ledger's reserved `::`
 * namespace (see {@link PLAN_KEY_INFIX}). Replaying the whole set is therefore a
 * no-op per row (INV-LEDGER-3), while a *partial* replay under a changed plan
 * conflicts loudly instead of double-consuming, because a given index's key is
 * bound to the payload it was first written with.
 *
 * The result is deep-frozen; applying it is the caller's job (`appendTransactions`).
 */
export function consumptionInputsFromPlan(
  plan: ConsumptionPlan,
  base: ConsumptionInputBase,
): Outcome<readonly TransactionInput[]> {
  if (typeof plan !== "object" || plan === null || !isAllocationArray(plan.allocations)) {
    return err("INVALID_FIELD", "plan.allocations must be an array", "plan");
  }
  const baseProblem = validateBase(base);
  if (baseProblem !== null) return { ok: false, error: baseProblem };

  // Copied once: every derived input shares the planner's own frozen copies, so
  // the caller's objects are never carried into the ledger and never frozen.
  const actor = copyActor(base.actor);
  if (!actor.ok) return actor;
  const provenance = copyProvenance(base.provenance);
  const correlationRef =
    base.correlationRef === undefined ? undefined : copyCorrelationRef(base.correlationRef);

  const seenLots = new Set<string>();
  const inputs: TransactionInput[] = [];
  for (const [index, allocation] of plan.allocations.entries()) {
    const problem = validateAllocation(allocation, index);
    if (problem !== null) return { ok: false, error: problem };
    if (seenLots.has(allocation.lotId)) {
      // Two writes against one lot could jointly overdraw it even though each
      // alone fits — the no-clamp guarantee holds per plan, not per row.
      return err(
        "INVALID_FIELD",
        `lot ${allocation.lotId} appears in more than one allocation`,
        "allocations",
      );
    }
    seenLots.add(allocation.lotId);

    const input: TransactionInput = {
      lotId: allocation.lotId,
      type: base.type,
      // Exact by construction: the decimal view of the allocation's micro-units.
      qtyDelta: microsToAmount(allocation.qtyDeltaMicros),
      unit: base.unit,
      actor: actor.value,
      occurredAt: base.occurredAt,
      recordedAt: base.recordedAt,
      provenance,
      idempotencyKey: `${base.idempotencyKey}${PLAN_KEY_INFIX}${String(index)}`,
    };
    inputs.push({
      ...input,
      ...(base.reason === undefined ? {} : { reason: base.reason }),
      ...(correlationRef === undefined ? {} : { correlationRef }),
    });
  }

  return ok<readonly TransactionInput[]>(deepFreeze(inputs));
}
