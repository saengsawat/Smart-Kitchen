/**
 * Read model behind `GET /v1/inventory/items/{itemId}` (M2-T2).
 *
 * S5's payload: the item summary (`snapshot.ts`) plus its whole ledger in
 * `sequence` order, which is the ledger's authoritative order and not
 * `recorded_at` (two rows can share a timestamp; domain-model.md §2).
 *
 * Three things this module is careful about.
 *
 * - **A person is reduced to initials here, and nowhere else.** The ledger
 *   stores `actor_user_id`; the screen renders a two-letter chip. The name is
 *   read inside the caller's own transaction, where the `users_shared_household`
 *   policy already restricts it to members of the caller's household, reduced
 *   immediately, and never returned, never logged (ARCHITECTURE.md §7.7,
 *   §7.15). A `system` row has no initials at all, because it is not a person
 *   and copy-deck.md §5 forbids attributing the clamp to one.
 * - **The clamp is reported as itself.** `systemFlag` travels so a screen can
 *   render the row as the ledger's own correction rather than as something a
 *   member did (INV-LEDGER-4, copy-deck.md §5).
 * - **No arithmetic.** Deltas are the exact stored `bigint`s rendered as
 *   decimal text. Balances come from the trigger-maintained snapshot via the
 *   summary read, never re-derived here.
 *
 * The write path needs more than the DTO carries (the idempotency key and the
 * lot a row landed on, to find a write's own rows again and to compensate them
 * per lot), so the reader returns {@link LedgerHistoryEntry} and the DTO is
 * projected out of it. Those extra fields are deliberately not on the wire: an
 * idempotency key is the caller's own, and a lot is not the client's business
 * (see the contracts' rule 4).
 */

import type {
  FieldProvenanceDto,
  InventoryHistoryEntryDto,
  InventoryItemDetailDto,
  InventoryMoveEntryDto,
  InventoryTransactionDto,
  ProvenanceTierDto,
  TransactionActorDto,
  TransactionTypeDto,
} from "@smart-kitchen/contracts";
import { TRANSACTION_TYPES_DTO } from "@smart-kitchen/contracts";
import type { ClientBase } from "pg";
import { microsToDecimalText } from "./repository.js";
import { confirmedProvenance } from "./confirmed-provenance.js";
import { mergeMovesIntoHistory } from "./history-merge.js";
import { displayInitials } from "./initials.js";
import { parseStoredLocation, readMoveRows, type MoveRow } from "./moves.js";
import { readInventoryItemSummary, UnknownStoredValueError } from "./snapshot.js";

// Moved to `initials.ts` by M2-T5 so the summary read can use it without an
// import cycle; re-exported so every existing importer keeps working.
export { displayInitials } from "./initials.js";

const PROVENANCE_TIERS: ReadonlySet<string> = new Set([
  "KNOWN_FACT",
  "ESTIMATED",
  "AI_INTERPRETATION",
] satisfies ProvenanceTierDto[]);

const ACTOR_KINDS: ReadonlySet<string> = new Set(["user", "system", "ai-confirmed"]);

const TRANSACTION_TYPES: ReadonlySet<string> = new Set<string>(TRANSACTION_TYPES_DTO);

/** One ledger row, as the write path and the detail endpoint both need it. */
export interface LedgerHistoryEntry {
  readonly transactionId: string;
  readonly sequence: number;
  readonly lotId: string;
  readonly deltaMicros: bigint;
  /** The row's own key. Never leaves the server. */
  readonly idempotencyKey: string;
  /** `recorded_at` at stored microsecond precision, fixed-width ISO text (M2-T6: the history merge key). Never on the wire. */
  readonly recordedAtUs: string;
  /** The key of the row this one compensates, on a ledger-authored clamp row. */
  readonly clampCauseKey: string | null;
  readonly dto: InventoryTransactionDto;
}

interface HistoryRow {
  readonly id: string;
  readonly sequence: number;
  readonly lot_id: string;
  readonly type: string;
  readonly qty_delta_micros: string;
  readonly reason: string | null;
  readonly recorded_at: Date;
  readonly recorded_at_us: string;
  readonly actor_kind: string;
  readonly actor_display_name: string | null;
  readonly provenance_tier: string;
  readonly provenance_source: string;
  readonly provenance_confidence: string | null;
  readonly idempotency_key: string;
  readonly system_flag_kind: string | null;
  readonly system_flag_caused_by_idempotency_key: string | null;
  /** M2-T5: whether a member confirmed this row (`inventory_confirmations`, D-028). */
  readonly confirmed: boolean;
  readonly confirmer_display_name: string | null;
}

/**
 * The item's ledger, oldest first, with the actor's display name joined on.
 *
 * A `LEFT JOIN`, not an inner one: a row whose actor is the system has no user
 * to join, and a user the `users_shared_household` policy hides must make the
 * row render without a chip rather than make the row vanish. History that
 * silently loses a statement is worse than history with an unattributed one.
 *
 * M2-T5 joins the row's confirmation, if any, and the confirmer's display
 * name, both `LEFT JOIN`s for the same reason. `UNIQUE (household_id,
 * transaction_id)` on the confirmations table means the join can never
 * duplicate a ledger row.
 */
const HISTORY_SQL = `
  SELECT t.id                          AS id,
         t.sequence                    AS sequence,
         t.lot_id                      AS lot_id,
         t.type                        AS type,
         t.qty_delta_micros::text      AS qty_delta_micros,
         t.reason                      AS reason,
         t.recorded_at                 AS recorded_at,
         to_char(t.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at_us,
         t.actor_kind                  AS actor_kind,
         u.display_name                AS actor_display_name,
         t.provenance_tier             AS provenance_tier,
         t.provenance_source           AS provenance_source,
         t.provenance_confidence::text AS provenance_confidence,
         t.idempotency_key             AS idempotency_key,
         t.system_flag_kind            AS system_flag_kind,
         t.system_flag_caused_by_idempotency_key AS system_flag_caused_by_idempotency_key,
         (c.id IS NOT NULL)            AS confirmed,
         cu.display_name               AS confirmer_display_name
    FROM inventory_transactions AS t
    LEFT JOIN users AS u ON u.id = t.actor_user_id
    LEFT JOIN inventory_confirmations AS c
      ON c.household_id = t.household_id
     AND c.transaction_id = t.id
    LEFT JOIN users AS cu ON cu.id = c.confirmed_by
   WHERE t.household_id = $1
     AND t.item_id = $2
   ORDER BY t.sequence`;

function toActor(row: HistoryRow): TransactionActorDto {
  if (!ACTOR_KINDS.has(row.actor_kind)) {
    throw new UnknownStoredValueError("inventory_transactions.actor_kind", row.actor_kind);
  }
  const kind = row.actor_kind as TransactionActorDto["kind"];
  if (kind === "system") return { kind };
  const initials = displayInitials(row.actor_display_name);
  return initials === undefined ? { kind } : { kind, displayInitials: initials };
}

function toProvenance(row: HistoryRow): FieldProvenanceDto {
  if (!PROVENANCE_TIERS.has(row.provenance_tier)) {
    throw new UnknownStoredValueError(
      "inventory_transactions.provenance_tier",
      row.provenance_tier,
    );
  }
  const stored: FieldProvenanceDto = {
    tier: row.provenance_tier as ProvenanceTierDto,
    source: row.provenance_source,
    confidence: row.provenance_confidence,
    recordedAt: row.recorded_at.toISOString(),
  };
  // M2-T5: a confirmed AI row presents as KNOWN_FACT, the ledger row unchanged.
  return confirmedProvenance(stored, {
    confirmed: row.confirmed,
    confirmerDisplayName: row.confirmer_display_name,
  });
}

function toEntry(row: HistoryRow): LedgerHistoryEntry {
  if (!TRANSACTION_TYPES.has(row.type)) {
    throw new UnknownStoredValueError("inventory_transactions.type", row.type);
  }
  if (row.system_flag_kind !== null && row.system_flag_kind !== "OVER_CONSUMPTION") {
    throw new UnknownStoredValueError(
      "inventory_transactions.system_flag_kind",
      row.system_flag_kind,
    );
  }
  const micros = BigInt(row.qty_delta_micros);
  const dto: InventoryTransactionDto = {
    transactionId: row.id,
    type: row.type as TransactionTypeDto,
    deltaMicros: row.qty_delta_micros,
    amount: microsToDecimalText(micros),
    recordedAt: row.recorded_at.toISOString(),
    actor: toActor(row),
    provenance: toProvenance(row),
    reason: row.reason,
    ...(row.system_flag_kind === null ? {} : { systemFlag: "OVER_CONSUMPTION" as const }),
  };
  return {
    transactionId: row.id,
    sequence: row.sequence,
    lotId: row.lot_id,
    deltaMicros: micros,
    idempotencyKey: row.idempotency_key,
    recordedAtUs: row.recorded_at_us,
    clampCauseKey: row.system_flag_caused_by_idempotency_key,
    dto,
  };
}

/**
 * Reads one item's ledger.
 *
 * `client` must already be inside the caller's tenant transaction, like every
 * other read in `src/db`.
 */
export async function readInventoryHistory(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<LedgerHistoryEntry[]> {
  const rows = await client.query<HistoryRow>(HISTORY_SQL, [householdId, itemId]);
  return rows.rows.map(toEntry);
}

function toMoveDto(row: MoveRow): InventoryMoveEntryDto {
  const initials = displayInitials(row.actor_display_name);
  const toLocation = parseStoredLocation("inventory_item_moves.to_location", row.to_location);
  if (toLocation === null) {
    throw new UnknownStoredValueError("inventory_item_moves.to_location", row.to_location);
  }
  return {
    type: "MOVED",
    moveId: row.id,
    fromLocation: parseStoredLocation("inventory_item_moves.from_location", row.from_location),
    toLocation,
    recordedAt: row.occurred_at.toISOString(),
    actor: initials === undefined ? { kind: "user" } : { kind: "user", displayInitials: initials },
  };
}

/** Summary plus history, or `undefined` when the item is not visible to this session. */
export async function readInventoryItemDetail(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<
  { readonly detail: InventoryItemDetailDto; readonly history: LedgerHistoryEntry[] } | undefined
> {
  const summary = await readInventoryItemSummary(client, householdId, itemId);
  if (summary === undefined) return undefined;
  const history = await readInventoryHistory(client, householdId, itemId);
  // M2-T6: the item's moves are merged in by time (history-merge.ts). `history`
  // in the return value stays ledger-only: the write path needs ledger rows.
  const moves = await readMoveRows(client, householdId, itemId);
  const merged = mergeMovesIntoHistory<InventoryHistoryEntryDto, InventoryHistoryEntryDto>(
    history.map((entry) => ({ at: entry.recordedAtUs, value: entry.dto })),
    moves.map((row) => ({ at: row.occurred_at_us, id: row.id, value: toMoveDto(row) })),
  );
  return { detail: { summary, history: merged }, history };
}
