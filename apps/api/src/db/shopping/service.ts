/**
 * The shopping list's read and its three writes (M7-T1 (b) to (e)).
 *
 * Every function here runs inside the caller's household transaction
 * (`TenantSessionRunner`), filters by `household_id` in its own SQL as well
 * (the app-layer half of data-model.md §5; the 0009 policies are the other
 * half), and takes the caller's identity as an argument the route read from
 * the session. Nothing below accepts a household, a member or a lot from a
 * request.
 *
 * **Once per row.** Add-to-inventory takes the row's lock, then the item's,
 * and appends one PURCHASE whose ledger key is derived from the row and its
 * generation (`shopping-row/<rowId>/generation/<n>`), in the same transaction
 * that stores `added_transaction_id` on the row. Three things then stop a
 * second PURCHASE for the same row and generation, from the outside in:
 *
 *   1. the row lock serialises every add for the row, and a waiter re-reads
 *      the row after the lock is granted (READ COMMITTED re-evaluates a
 *      `FOR UPDATE` row), so it sees `added_transaction_id` and answers with
 *      the original transaction;
 *   2. the derived ledger key is under the household-scoped unique index on
 *      `inventory_transactions`, so even a path that skipped the row lock
 *      could not append a second row under it;
 *   3. migration 0009's trigger makes `added_transaction_id` write-once.
 *
 * The derived key contains `/`, which no client key may (`CLIENT_KEY`), and
 * no `/lot/` infix, so it can never collide with an M2-T2 write's rows; S5's
 * undo still finds it, because an undo groups a key with no infix by the key
 * itself.
 *
 * **Keys.** The client's `idempotencyKey` on both keyed writes is recorded in
 * `shopping_row_writes`, household-scoped, the M2-T2 shape. A key already
 * recorded is a replay only when kind, row, caller and (for a check) the
 * requested state all match; anything else is `IDEMPOTENCY_KEY_CONFLICT`.
 * Keys are never logged.
 */

import type {
  InventoryItemDetailDto,
  InventoryItemSummaryDto,
  InventoryTransactionDto,
  ProvenanceTierDto,
  ShoppingListDto,
  ShoppingMemberDto,
  ShoppingRowDto,
  ShoppingRowOriginDto,
  ShoppingRowStatusDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import {
  ledgerError,
  microsToAmount,
  PLAN_KEY_INFIX,
  RESERVED_KEY_SEPARATOR,
  type LedgerError,
  type TransactionInput,
} from "@smart-kitchen/domain";
import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import { readHousehold } from "../households/repository.js";
import { displayInitials, readInventoryItemDetail } from "../inventory/detail.js";
import {
  appendTransactionToDb,
  insertInventoryLot,
  loadInventoryItem,
} from "../inventory/repository.js";
import {
  readInventoryItemSummary,
  readInventorySnapshot,
  UnknownStoredValueError,
} from "../inventory/snapshot.js";
import {
  increaseLot,
  InventoryItemNotVisibleError,
  LedgerIntegrityError,
  LedgerWriteRejectedError,
} from "../inventory/write-service.js";
import { CLIENT_KEY } from "../inventory/client-key.js";
import { computeRowGap, type GapItemInput } from "./gap.js";

/** Provenance source on the PURCHASE an add-to-inventory appends. */
export const SHOPPING_CHECK_OFF_SOURCE = "shopping-check-off";

/** The ledger key of a row's PURCHASE: one per row and generation. */
export function shoppingPurchaseKey(rowId: string, generation: number): string {
  return `shopping-row/${rowId}/generation/${String(generation)}`;
}

/** The row is not on this household's list: no such row, another household's, or removed. */
export class ShoppingRowNotVisibleError extends Error {
  constructor() {
    super("the addressed shopping row is not visible to this session");
    this.name = "ShoppingRowNotVisibleError";
  }
}

/** Add-to-inventory on a row that names no item (409 `ROW_HAS_NO_ITEM`). */
export class ShoppingRowHasNoItemError extends Error {
  constructor() {
    super("the shopping row names no inventory item to purchase into");
    this.name = "ShoppingRowHasNoItemError";
  }
}

/** Add-to-inventory on a row that is not checked off (409 `CONFLICT`). */
export class ShoppingRowNotCheckedOffError extends Error {
  constructor() {
    super("the shopping row must be checked off before it is added to inventory");
    this.name = "ShoppingRowNotCheckedOffError";
  }
}

/** The session's user has no membership row in the session's household. */
export class ShoppingMembershipMissingError extends Error {
  constructor() {
    super("the session's user has no membership in the session's household");
    this.name = "ShoppingMembershipMissingError";
  }
}

function reject(code: LedgerError["code"], message: string, field?: string): never {
  throw new LedgerWriteRejectedError(ledgerError(code, message, field));
}

function validateClientKey(key: string): void {
  if (
    !CLIENT_KEY.test(key) ||
    key.includes(RESERVED_KEY_SEPARATOR) ||
    key.includes(PLAN_KEY_INFIX)
  ) {
    reject(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be 1 to 128 characters of letters, digits, dot, underscore or hyphen",
      "idempotencyKey",
    );
  }
}

function keyConflict(): never {
  reject(
    "IDEMPOTENCY_KEY_CONFLICT",
    "idempotencyKey was already used for a different shopping change in this household",
    "idempotencyKey",
  );
}

// --- Stored values -------------------------------------------------------------

const STATUSES: ReadonlySet<string> = new Set(["open", "done", "skipped"]);
const LOCATIONS: ReadonlySet<string> = new Set(["FRIDGE", "FREEZER", "PANTRY", "OTHER"]);

/** One row as the database holds it, with the member names joined on. */
interface StoredRow {
  readonly id: string;
  readonly name: string;
  readonly group_label: string;
  readonly origin_kind: string;
  readonly origin_member_id: string | null;
  readonly origin_display_name: string | null;
  readonly need_micros: string;
  readonly unit: string;
  readonly item_id: string | null;
  readonly default_location: string;
  readonly status: string;
  readonly checked_off_by: string | null;
  readonly checked_display_name: string | null;
  readonly added_transaction_id: string | null;
  readonly generation: number;
  readonly removed_at: Date | null;
  /** The landed PURCHASE's own ledger row, joined on; all null until one lands. */
  readonly purchase_micros: string | null;
  readonly purchase_unit: string | null;
  readonly purchase_type: string | null;
}

const ROW_COLUMNS = `
  r.id, r.name, r.group_label, r.origin_kind, r.origin_member_id,
  ou.display_name AS origin_display_name,
  r.need_micros::text AS need_micros, r.unit, r.item_id, r.default_location, r.status,
  r.checked_off_by, cu.display_name AS checked_display_name,
  r.added_transaction_id, r.generation, r.removed_at,
  pt.qty_delta_micros::text AS purchase_micros, pt.unit AS purchase_unit,
  pt.type AS purchase_type`;

const ROW_JOINS = `
  LEFT JOIN household_memberships AS om
    ON om.household_id = r.household_id AND om.id = r.origin_member_id
  LEFT JOIN users AS ou ON ou.id = om.user_id
  LEFT JOIN household_memberships AS cm
    ON cm.household_id = r.household_id AND cm.id = r.checked_off_by
  LEFT JOIN users AS cu ON cu.id = cm.user_id
  LEFT JOIN inventory_transactions AS pt
    ON pt.household_id = r.household_id AND pt.item_id = r.item_id
   AND pt.id = r.added_transaction_id`;

/** The list, in insertion order. Removed rows are not on it. */
const LIST_SQL = `
  SELECT ${ROW_COLUMNS}
    FROM shopping_rows AS r ${ROW_JOINS}
   WHERE r.household_id = $1 AND r.removed_at IS NULL
   ORDER BY r.created_at, r.id`;

/** One row, any state, for a write's own read-back. */
const ROW_SQL = `
  SELECT ${ROW_COLUMNS}
    FROM shopping_rows AS r ${ROW_JOINS}
   WHERE r.household_id = $1 AND r.id = $2`;

/**
 * Takes the row's write lock. `FOR UPDATE OF r` locks the shopping row only,
 * never the joined membership or user rows.
 */
const LOCK_ROW_SQL = `${ROW_SQL}
     FOR UPDATE OF r`;

function toStatus(value: string): "open" | "done" | "skipped" {
  if (!STATUSES.has(value)) throw new UnknownStoredValueError("shopping_rows.status", value);
  return value as "open" | "done" | "skipped";
}

function toLocation(value: string): StorageLocationDto {
  if (!LOCATIONS.has(value)) {
    throw new UnknownStoredValueError("shopping_rows.default_location", value);
  }
  return value as StorageLocationDto;
}

function toOrigin(row: StoredRow): ShoppingRowOriginDto {
  if (row.origin_kind !== "member" || row.origin_member_id === null) {
    throw new UnknownStoredValueError("shopping_rows.origin_kind", row.origin_kind);
  }
  return {
    kind: "member",
    memberId: row.origin_member_id,
    initials: displayInitials(row.origin_display_name) ?? "?",
    displayName: row.origin_display_name ?? "",
  };
}

/** The item half of the gap, from the same snapshot S4 reads. */
type ItemsById = ReadonlyMap<string, GapItemInput>;

function gapItemOf(item: InventoryItemSummaryDto): GapItemInput {
  return {
    unit: item.quantity.unit,
    currentMicros: BigInt(item.quantity.micros),
    quantityTier: item.provenance.quantity?.tier ?? null,
  };
}

async function snapshotItems(client: ClientBase, householdId: string): Promise<ItemsById> {
  const items = await readInventorySnapshot(client, householdId);
  return new Map(items.map((item) => [item.itemId, gapItemOf(item)]));
}

/** One item's gap input, read the same way (`readInventoryItemSummary`, the single-item twin). */
async function snapshotItem(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<ItemsById> {
  const item = await readInventoryItemSummary(client, householdId, itemId);
  return item === undefined ? new Map() : new Map([[itemId, gapItemOf(item)]]);
}

/** What a row's landed PURCHASE says, as `rowBuyMicros` reads it. */
export interface LandedPurchase {
  readonly addedTransactionId: string | null;
  /** `inventory_transactions.qty_delta_micros` of that row, as text; null when the join found nothing. */
  readonly purchaseMicros: string | null;
  readonly purchaseUnit: string | null;
  readonly purchaseType: string | null;
}

/**
 * The `buyMicros` a row answers with (BUG-006).
 *
 * Before a PURCHASE lands it is the live gap, the domain's `neededQuantity`
 * of need against the current snapshot (INV-SHOP-1). Once one has landed
 * (`added_transaction_id` set) it is the amount that PURCHASE appended, read
 * from its ledger row and never recomputed: the live gap is computed against
 * stock that already includes the purchase, so it would read 0 for exactly
 * the amount that was bought. An undo on S5 is its own ledger fact and leaves
 * the PURCHASE row, so the bought amount stays.
 *
 * A row that names a PURCHASE the join could not find, or one that is not a
 * positive PURCHASE in the row's unit, is a broken ledger, not a gap: it
 * fails loudly rather than falling back to the live gap.
 */
export function rowBuyMicros(unit: string, landed: LandedPurchase, liveBuyMicros: bigint): bigint {
  if (landed.addedTransactionId === null) return liveBuyMicros;
  const corrupt = (message: string): never => {
    throw new LedgerIntegrityError(ledgerError("CORRUPT_LEDGER", message));
  };
  if (landed.purchaseMicros === null) {
    return corrupt("a shopping row names a PURCHASE its item does not hold");
  }
  if (landed.purchaseType !== "PURCHASE" || landed.purchaseUnit !== unit) {
    return corrupt("a shopping row's PURCHASE is not a PURCHASE in the row's unit");
  }
  const micros = BigInt(landed.purchaseMicros);
  if (micros <= 0n) return corrupt("a shopping row's PURCHASE did not add stock");
  return micros;
}

/**
 * Row to DTO, gap included.
 *
 * The status on the wire is the stored one, except that an open row the
 * domain says needs nothing (`buy = 0`) answers as `skipped`: "already have
 * enough" is a fact about the item's current snapshot, so it is computed on
 * every read and never stored. That status always follows the live gap;
 * `buyMicros` follows it only until the row's PURCHASE lands (`rowBuyMicros`).
 */
function toRowDto(row: StoredRow, items: ItemsById): ShoppingRowDto {
  const item = row.item_id === null ? undefined : items.get(row.item_id);
  if (row.item_id !== null && item === undefined) {
    // The composite foreign key makes this unreachable; failing loudly beats
    // quietly answering "nothing on hand" for an item that exists.
    throw new InventoryItemNotVisibleError();
  }
  const gap = computeRowGap({ needMicros: BigInt(row.need_micros), unit: row.unit }, item);
  const stored = toStatus(row.status);
  const status: ShoppingRowStatusDto =
    stored === "open" && gap.buyMicros === 0n ? "skipped" : stored;
  return {
    rowId: row.id,
    name: row.name,
    group: row.group_label,
    origin: toOrigin(row),
    needMicros: row.need_micros,
    haveMicros: gap.haveMicros.toString(),
    haveTier: gap.haveTier satisfies ProvenanceTierDto | null,
    buyMicros: rowBuyMicros(
      row.unit,
      {
        addedTransactionId: row.added_transaction_id,
        purchaseMicros: row.purchase_micros,
        purchaseUnit: row.purchase_unit,
        purchaseType: row.purchase_type,
      },
      gap.buyMicros,
    ).toString(),
    unit: row.unit,
    itemId: row.item_id,
    status,
    checkedOffBy:
      row.checked_off_by === null ? null : (displayInitials(row.checked_display_name) ?? "?"),
    defaultLocation: toLocation(row.default_location),
  };
}

async function serverNow(client: ClientBase): Promise<string> {
  const result = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  const now = result.rows[0]?.now;
  if (now === undefined) throw new Error("clock_timestamp() returned no row");
  return now.toISOString();
}

// --- Read ----------------------------------------------------------------------

/** `GET /v1/shopping`. */
export async function readShoppingList(
  client: ClientBase,
  householdId: string,
): Promise<ShoppingListDto> {
  const rows = await client.query<StoredRow>(LIST_SQL, [householdId]);
  const items = rows.rows.some((row) => row.item_id !== null)
    ? await snapshotItems(client, householdId)
    : new Map<string, GapItemInput>();
  const household = await readHousehold(client, householdId);
  const members: ShoppingMemberDto[] = (household?.members ?? []).map((member) => ({
    memberId: member.membershipId,
    initials: displayInitials(member.displayName) ?? "?",
    displayName: member.displayName ?? "",
  }));
  return {
    rows: rows.rows.map((row) => toRowDto(row, items)),
    members,
    syncedAt: await serverNow(client),
  };
}

/** One row as the list would show it, for a write's answer. */
async function readRowDto(
  client: ClientBase,
  householdId: string,
  rowId: string,
): Promise<ShoppingRowDto> {
  const result = await client.query<StoredRow>(ROW_SQL, [householdId, rowId]);
  const row = result.rows[0];
  if (row === undefined) throw new ShoppingRowNotVisibleError();
  const items =
    row.item_id === null
      ? new Map<string, GapItemInput>()
      : await snapshotItem(client, householdId, row.item_id);
  return toRowDto(row, items);
}

// --- Shared write steps --------------------------------------------------------

async function lockVisibleRow(
  client: ClientBase,
  householdId: string,
  rowId: string,
): Promise<StoredRow> {
  const result = await client.query<StoredRow>(LOCK_ROW_SQL, [householdId, rowId]);
  const row = result.rows[0];
  if (row === undefined || row.removed_at !== null) throw new ShoppingRowNotVisibleError();
  return row;
}

async function callerMemberId(
  client: ClientBase,
  householdId: string,
  userId: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM household_memberships WHERE household_id = $1 AND user_id = $2",
    [householdId, userId],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new ShoppingMembershipMissingError();
  return id;
}

interface StoredWrite {
  readonly row_id: string;
  readonly kind: string;
  readonly checked: boolean | null;
  readonly actor_member_id: string;
  readonly transaction_id: string | null;
}

async function findWrite(
  client: ClientBase,
  householdId: string,
  key: string,
): Promise<StoredWrite | undefined> {
  const result = await client.query<StoredWrite>(
    `SELECT row_id, kind, checked, actor_member_id, transaction_id
       FROM shopping_row_writes
      WHERE household_id = $1 AND idempotency_key = $2`,
    [householdId, key],
  );
  return result.rows[0];
}

interface NewWrite {
  readonly key: string;
  readonly rowId: string;
  readonly kind: "check" | "add";
  readonly checked: boolean | null;
  readonly generation: number;
  readonly actorMemberId: string;
  readonly transactionId: string | null;
}

/**
 * Records a key. `ON CONFLICT DO NOTHING` rather than a caught unique
 * violation, so a race with a concurrent write that claimed the same key for
 * a *different* row (only a different row can race here: the same row is
 * serialised by its lock) leaves this transaction usable and answers 409.
 */
async function recordWrite(
  client: ClientBase,
  householdId: string,
  write: NewWrite,
): Promise<void> {
  const inserted = await client.query(
    `INSERT INTO shopping_row_writes
       (household_id, idempotency_key, row_id, kind, checked, generation, actor_member_id,
        transaction_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT ON CONSTRAINT shopping_row_writes_pkey DO NOTHING`,
    [
      householdId,
      write.key,
      write.rowId,
      write.kind,
      write.checked,
      write.generation,
      write.actorMemberId,
      write.transactionId,
    ],
  );
  if (inserted.rowCount !== 1) keyConflict();
}

// --- Check-off -----------------------------------------------------------------

export interface CheckShoppingRowCommand {
  readonly idempotencyKey: string;
  readonly checked: boolean;
  /** The session's user. Never a request field. */
  readonly actorUserId: string;
}

export interface CheckShoppingRowResult {
  readonly row: ShoppingRowDto;
  /** True when the key was already recorded for exactly this change, so nothing was written. */
  readonly replayed: boolean;
  /** True when this call moved the row's state (false for a replay and for a no-op set). */
  readonly changed: boolean;
}

/**
 * `POST /v1/shopping/rows/{rowId}/check`: set-state.
 *
 * Checking a done row, or unchecking an open one, changes nothing and still
 * records the key, so the same key with the other value later is a conflict
 * rather than a second, different change. Unchecking never touches
 * `added_transaction_id`: a landed PURCHASE is reversed by S5's undo, not by
 * the list.
 */
export async function checkShoppingRow(
  client: ClientBase,
  householdId: string,
  rowId: string,
  command: CheckShoppingRowCommand,
): Promise<CheckShoppingRowResult> {
  validateClientKey(command.idempotencyKey);
  const row = await lockVisibleRow(client, householdId, rowId);
  const actorMemberId = await callerMemberId(client, householdId, command.actorUserId);

  const existing = await findWrite(client, householdId, command.idempotencyKey);
  if (existing !== undefined) {
    const same =
      existing.kind === "check" &&
      existing.row_id === rowId &&
      existing.checked === command.checked &&
      existing.actor_member_id === actorMemberId;
    if (!same) keyConflict();
    return { row: await readRowDto(client, householdId, rowId), replayed: true, changed: false };
  }

  const done = toStatus(row.status) === "done";
  const changed = command.checked !== done;
  if (changed && command.checked) {
    await client.query(
      `UPDATE shopping_rows AS r
          SET status = 'done', checked_off_by = $3, checked_off_at = t.now, updated_at = t.now
         FROM (SELECT clock_timestamp() AS now) AS t
        WHERE r.household_id = $1 AND r.id = $2`,
      [householdId, rowId, actorMemberId],
    );
  } else if (changed) {
    await client.query(
      `UPDATE shopping_rows
          SET status = 'open', checked_off_by = NULL, checked_off_at = NULL,
              updated_at = clock_timestamp()
        WHERE household_id = $1 AND id = $2`,
      [householdId, rowId],
    );
  }
  await recordWrite(client, householdId, {
    key: command.idempotencyKey,
    rowId,
    kind: "check",
    checked: command.checked,
    generation: row.generation,
    actorMemberId,
    transactionId: null,
  });
  return { row: await readRowDto(client, householdId, rowId), replayed: false, changed };
}

// --- Add to inventory ----------------------------------------------------------

export interface AddShoppingRowCommand {
  readonly idempotencyKey: string;
  readonly actorUserId: string;
}

export interface AddShoppingRowResult {
  /** The row's one PURCHASE, the same on every call for the row and generation. */
  readonly transactions: readonly InventoryTransactionDto[];
  readonly detail: InventoryItemDetailDto;
  /** True when nothing was appended by this call. */
  readonly replayed: boolean;
  readonly transactionId: string;
}

async function resultFor(
  client: ClientBase,
  householdId: string,
  itemId: string,
  transactionId: string,
  replayed: boolean,
): Promise<AddShoppingRowResult> {
  const read = await readInventoryItemDetail(client, householdId, itemId);
  if (read === undefined) throw new InventoryItemNotVisibleError();
  const entry = read.history.find((candidate) => candidate.transactionId === transactionId);
  if (entry === undefined) {
    throw new LedgerIntegrityError(
      ledgerError("CORRUPT_LEDGER", "a shopping row names a PURCHASE its item does not hold"),
    );
  }
  return { transactions: [entry.dto], detail: read.detail, replayed, transactionId };
}

/**
 * `POST /v1/shopping/rows/{rowId}/add-to-inventory`.
 *
 * Order of the answers, each decided under the row lock:
 *
 * 1. a key already recorded: the same add (same row, same caller) replays
 *    its transaction; anything else is 409 `IDEMPOTENCY_KEY_CONFLICT`;
 * 2. no item on the row: 409 `ROW_HAS_NO_ITEM`;
 * 3. a PURCHASE already landed for this row and generation: 200 with that
 *    transaction and nothing appended, whatever the key (the new key is
 *    recorded against the same transaction);
 * 4. the row is not checked off: 409;
 * 5. otherwise one PURCHASE of the domain's gap, in the row's unit, through
 *    the ledger, which refuses a unit that is not the item's (`MIXED_UNITS`)
 *    and a gap of zero (`ZERO_DELTA`) with its own codes.
 */
export async function addShoppingRowToInventory(
  client: ClientBase,
  householdId: string,
  rowId: string,
  command: AddShoppingRowCommand,
): Promise<AddShoppingRowResult> {
  validateClientKey(command.idempotencyKey);
  const row = await lockVisibleRow(client, householdId, rowId);
  const actorMemberId = await callerMemberId(client, householdId, command.actorUserId);

  const existing = await findWrite(client, householdId, command.idempotencyKey);
  if (existing !== undefined) {
    const same =
      existing.kind === "add" &&
      existing.row_id === rowId &&
      existing.actor_member_id === actorMemberId;
    // A recorded add always carries its transaction (0009 CHECK), and a row
    // with a recorded add always has its item (0009 CHECK on the row).
    if (!same || existing.transaction_id === null || row.item_id === null) keyConflict();
    return resultFor(client, householdId, row.item_id, existing.transaction_id, true);
  }

  const itemId = row.item_id;
  if (itemId === null) throw new ShoppingRowHasNoItemError();

  if (row.added_transaction_id !== null) {
    await recordWrite(client, householdId, {
      key: command.idempotencyKey,
      rowId,
      kind: "add",
      checked: null,
      generation: row.generation,
      actorMemberId,
      transactionId: row.added_transaction_id,
    });
    return resultFor(client, householdId, itemId, row.added_transaction_id, true);
  }

  if (toStatus(row.status) !== "done") throw new ShoppingRowNotCheckedOffError();

  // The item's lock, then its aggregate: the gap is computed against the
  // balance nothing else can move until this transaction ends.
  const locked = await client.query<{ id: string }>(
    "SELECT id FROM inventory_items WHERE household_id = $1 AND id = $2 FOR UPDATE",
    [householdId, itemId],
  );
  if (locked.rows.length === 0) throw new InventoryItemNotVisibleError();
  const loaded = await loadInventoryItem(client, householdId, itemId);
  if (!loaded.ok) {
    if (loaded.error.code === "ITEM_MISMATCH") throw new InventoryItemNotVisibleError();
    throw new LedgerIntegrityError(loaded.error);
  }
  const item = loaded.value;
  // The same gap the list shows, from the same snapshot read, taken under
  // the item's lock (and `loadInventoryItem` has just recomputed that
  // snapshot from the ledger and checked it).
  const snapshot = await snapshotItem(client, householdId, itemId);
  const gap = computeRowGap(
    { needMicros: BigInt(row.need_micros), unit: row.unit },
    snapshot.get(itemId),
  );

  const at = await serverNow(client);
  let lotId = increaseLot(item)?.lotId;
  if (lotId === undefined) {
    // An item with no lot at all: the PURCHASE opens one, acquired now. The
    // id is minted here, never taken from a request.
    lotId = randomUUID();
    await insertInventoryLot(client, householdId, itemId, { lotId, acquiredAt: at });
  }

  const ledgerKey = shoppingPurchaseKey(rowId, row.generation);
  const input: TransactionInput = {
    lotId,
    type: "PURCHASE",
    qtyDelta: microsToAmount(gap.buyMicros),
    unit: row.unit,
    actor: { kind: "user", userId: command.actorUserId },
    occurredAt: at,
    recordedAt: at,
    provenance: { tier: "KNOWN_FACT", source: SHOPPING_CHECK_OFF_SOURCE },
    idempotencyKey: ledgerKey,
    correlationRef: { kind: "shopping-item", id: rowId },
  };
  const outcome = await appendTransactionToDb(client, householdId, itemId, input);
  if (!outcome.ok) {
    if (outcome.error.code === "ITEM_MISMATCH") throw new InventoryItemNotVisibleError();
    throw new LedgerIntegrityError(outcome.error);
  }
  const appended = outcome.value;
  if (appended.status === "rejected") {
    if (appended.error.code === "IDEMPOTENCY_KEY_CONFLICT") {
      // The derived key is this row's alone; a conflict on it means a row
      // under it that this row did not record, which is not the caller's doing.
      throw new LedgerIntegrityError(appended.error);
    }
    throw new LedgerWriteRejectedError(appended.error);
  }
  if (appended.status !== "appended") {
    throw new LedgerIntegrityError(
      ledgerError("CORRUPT_LEDGER", "a shopping PURCHASE key existed before its row recorded it"),
    );
  }

  const read = await client.query<{ id: string }>(
    `SELECT id FROM inventory_transactions
      WHERE household_id = $1 AND item_id = $2 AND idempotency_key = $3`,
    [householdId, itemId, ledgerKey],
  );
  const transactionId = read.rows[0]?.id;
  if (transactionId === undefined) {
    throw new LedgerIntegrityError(
      ledgerError("CORRUPT_LEDGER", "an appended shopping PURCHASE could not be read back"),
    );
  }

  await client.query(
    `UPDATE shopping_rows SET added_transaction_id = $3, updated_at = clock_timestamp()
      WHERE household_id = $1 AND id = $2`,
    [householdId, rowId, transactionId],
  );
  await recordWrite(client, householdId, {
    key: command.idempotencyKey,
    rowId,
    kind: "add",
    checked: null,
    generation: row.generation,
    actorMemberId,
    transactionId,
  });
  return resultFor(client, householdId, itemId, transactionId, false);
}

// --- Remove --------------------------------------------------------------------

export interface RemoveShoppingRowResult {
  /** False when the row was already removed (an idempotent repeat). */
  readonly removed: boolean;
}

/**
 * `POST /v1/shopping/rows/{rowId}/remove`: `status = skipped` plus who and
 * when; nothing is deleted. Only member-origin rows exist (the 0009 CHECK),
 * and any member of the household may remove one. A row whose PURCHASE has
 * landed may still be removed; the PURCHASE stays in the ledger.
 */
export async function removeShoppingRow(
  client: ClientBase,
  householdId: string,
  rowId: string,
  actorUserId: string,
): Promise<RemoveShoppingRowResult> {
  const result = await client.query<StoredRow>(LOCK_ROW_SQL, [householdId, rowId]);
  const row = result.rows[0];
  if (row === undefined) throw new ShoppingRowNotVisibleError();
  if (row.removed_at !== null) return { removed: false };
  // Stated in code as well as by the CHECK, so widening the CHECK for menu
  // and AI rows cannot silently widen who may remove them.
  if (row.origin_kind !== "member") {
    throw new UnknownStoredValueError("shopping_rows.origin_kind", row.origin_kind);
  }
  const actorMemberId = await callerMemberId(client, householdId, actorUserId);
  await client.query(
    `UPDATE shopping_rows AS r
        SET status = 'skipped', removed_by = $3, removed_at = t.now, updated_at = t.now
       FROM (SELECT clock_timestamp() AS now) AS t
      WHERE r.household_id = $1 AND r.id = $2`,
    [householdId, rowId, actorMemberId],
  );
  return { removed: true };
}
