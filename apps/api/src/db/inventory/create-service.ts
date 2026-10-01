/**
 * Item creation over the ledger (M2-T3 (e)): `POST /v1/inventory/items`.
 *
 * One request is one transaction, and inside it the item, its first lot and
 * its first ledger row are written together or not at all (no item without a
 * row, no row without an item). The ledger decides the row, as everywhere
 * else: the item shell is validated by `createInventoryItem` and the row by
 * `appendTransaction`, through the same repository functions the seed and
 * M2-T2 use. Nothing here adds or compares quantities except as exact
 * `bigint` micros (CLAUDE.md rule 7).
 *
 * **Idempotency.** The client key `K` becomes the ledger key `K/lot/0`, the
 * planner namespace every M2-T2 write uses, so "the rows of a write" stays one
 * rule across both endpoints and the household-scoped unique index on
 * `(household_id, idempotency_key)` is the backstop for both. A replay is
 * decided here rather than by the ledger, because the ledger compares a
 * replayed row against a new one and a create has no `occurredAt` in its body
 * (the server's clock fills it, so two attempts never match). Instead the
 * stored item, lot and row are compared field by field with what the request
 * describes: all equal is a replay (same item back, nothing appended), any
 * difference is `IDEMPOTENCY_KEY_CONFLICT` (409). A key M2-T2 already used on
 * some item is a conflict too, since that row is not a creation.
 *
 * **Two concurrent creates under one key** serialise on a transaction-scoped
 * advisory lock keyed on household and key, so the second one waits, then
 * sees the first one's committed row and answers as a replay rather than
 * racing it into a unique violation.
 *
 * **Provenance.** The row's tier is the request's `quantityProvenance.tier`
 * (Known Fact or Estimated; an AI interpretation is refused, because AI
 * output reaches the ledger only through a confirmation flow, CLAUDE.md rule
 * 8). The row's source is this server's stable identifier for the path, not
 * the request's free text. The lot's expiry tier is the request's
 * `bestByProvenance.tier`, passed through; with no best-by, there is no tier.
 */

import {
  CREATE_ITEM_UNITS_DTO,
  type CreateItemSourceDto,
  type InventoryItemSummaryDto,
  type ProvenanceTierDto,
  type StorageLocationDto,
} from "@smart-kitchen/contracts";
import {
  ledgerError,
  lookupUnit,
  microsToAmount,
  parseIsoInstantStrict,
  PLAN_KEY_INFIX,
  RESERVED_KEY_SEPARATOR,
  type LedgerError,
  type TransactionInput,
  type TransactionType,
} from "@smart-kitchen/domain";
import type { ClientBase } from "pg";
import { CLIENT_KEY } from "./client-key.js";
import { readInventoryItemDetail } from "./detail.js";
import { canonicalizeInstant } from "./mapping.js";
import { decimalTextToMicros } from "./quantity-text.js";
import { appendTransactionToDb, insertInventoryItem } from "./repository.js";
import {
  InventoryItemNotVisibleError,
  LedgerIntegrityError,
  LedgerWriteRejectedError,
} from "./write-service.js";

/** Provenance source recorded on the first row of a scanned item. */
export const BARCODE_SCAN_SOURCE = "barcode-scan";

/** Provenance source recorded on the first row of a manually added item. Same as M2-T2's. */
export const MANUAL_ENTRY_CREATE_SOURCE = "manual-entry";

/** Longest display name accepted, after trimming. */
export const MAX_DISPLAY_NAME_LENGTH = 120;

/** Longest product reference accepted. */
export const MAX_PRODUCT_REF_LENGTH = 128;

/** Control characters: never part of a name a person typed. */
const CONTROL_CHARACTERS = /\p{Cc}/u;

/** A calendar date with nothing else, read as UTC midnight (review F1). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The canonical instant for a best-by, or `undefined` when the text is not
 * exactly an ISO date or an ISO instant with an offset (M2-T3 review F1).
 *
 * `Date.parse` alone accepted `"1"` and `"March 7"` and read them in the
 * server's own time zone, so the stored date depended on the host. Only two
 * shapes are accepted now, and neither is read in local time: a bare
 * `YYYY-MM-DD` is UTC midnight, and an instant must state its offset. A date
 * that does not exist (`2026-02-30`) is refused rather than rolled over.
 */
export function canonicalBestBy(text: string): string | undefined {
  if (ISO_DATE.test(text)) {
    const millis = Date.parse(`${text}T00:00:00.000Z`);
    if (Number.isNaN(millis)) return undefined;
    const iso = new Date(millis).toISOString();
    return iso.slice(0, 10) === text ? iso : undefined;
  }
  // The domain's strict parser: shape plus a round trip, so a rolled-over
  // instant (`2026-02-30T00:00:00Z`, `T24:00:00Z`) is refused, not stored as
  // a different day (M9-T0 a).
  if (parseIsoInstantStrict(text) !== undefined) {
    return canonicalizeInstant(text);
  }
  return undefined;
}

/** A provenance block as the request carries it. */
export interface RequestProvenance {
  readonly tier: ProvenanceTierDto;
  readonly source: string | null;
  readonly confidence: string | null;
  readonly recordedAt: string | null;
}

/** The create request, with identity already resolved from the session. */
export interface CreateItemCommand {
  readonly idempotencyKey: string;
  readonly source: CreateItemSourceDto;
  readonly displayName: string;
  readonly storageLocation: StorageLocationDto;
  readonly unit: string;
  readonly amount: string;
  readonly quantityProvenance: RequestProvenance;
  readonly productRef?: string;
  readonly bestByDate?: string | null;
  readonly bestByProvenance?: RequestProvenance | null;
  /** Server clock; also the row's `occurredAt`, since the request states none. */
  readonly recordedAt: string;
  /** The session's user. Never a request field. */
  readonly actorUserId: string;
}

/** Fresh ids for a first attempt, minted by the caller (the route), never taken from the request. */
export interface NewItemIds {
  readonly itemId: string;
  readonly lotId: string;
}

export interface CreateItemResult {
  readonly summary: InventoryItemSummaryDto;
  /** True when the key was already used for this exact item, so nothing was written. */
  readonly replayed: boolean;
}

function reject(code: LedgerError["code"], message: string, field?: string): never {
  throw new LedgerWriteRejectedError(ledgerError(code, message, field));
}

/** What the request means once validated: exactly what will be stored. */
interface PlannedCreation {
  readonly ledgerKey: string;
  readonly type: TransactionType;
  readonly displayName: string;
  readonly storageLocation: StorageLocationDto;
  readonly unit: string;
  readonly micros: bigint;
  readonly tier: ProvenanceTierDto;
  readonly provenanceSource: string;
  readonly productRef: string | null;
  readonly expiresAt: string | null;
  readonly expiryTier: ProvenanceTierDto | null;
}

/**
 * Validates every field and returns the stored form. Exported so the refusals
 * can be tested without a database; every branch is one a client can reach.
 */
export function planCreation(command: CreateItemCommand): PlannedCreation {
  const key = command.idempotencyKey;
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

  const displayName = command.displayName.trim();
  if (
    displayName === "" ||
    [...displayName].length > MAX_DISPLAY_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(displayName)
  ) {
    reject(
      "INVALID_FIELD",
      `displayName must be 1 to ${String(MAX_DISPLAY_NAME_LENGTH)} printable characters`,
      "displayName",
    );
  }

  // Two checks, both required: the unit is one a screen offers, and the domain
  // registry resolves it. The consistency suite proves the first implies the
  // second; checking both here means a drift fails closed rather than open.
  if (!CREATE_ITEM_UNITS_DTO.includes(command.unit) || !lookupUnit(command.unit).ok) {
    reject("INVALID_FIELD", "unit is not one of the units an item can be created in", "unit");
  }

  const parsed = decimalTextToMicros(command.amount, "amount");
  if (!parsed.ok) throw new LedgerWriteRejectedError(parsed.error);
  const micros = parsed.value;
  if (micros === 0n) reject("ZERO_DELTA", "a new item must start with some stock", "amount");
  if (micros < 0n) reject("WRONG_SIGN", "amount is a positive quantity on hand", "amount");

  const quantity = command.quantityProvenance;
  if (quantity.tier === "AI_INTERPRETATION") {
    reject(
      "INVALID_FIELD",
      "an AI interpretation cannot be the first fact about an item; it needs confirming first",
      "quantityProvenance",
    );
  }
  if (quantity.confidence !== null || quantity.recordedAt !== null) {
    reject(
      "INVALID_FIELD",
      "quantityProvenance.confidence and recordedAt must be null; the server records when it recorded",
      "quantityProvenance",
    );
  }

  let productRef: string | null = null;
  if (command.source === "BARCODE") {
    const ref = command.productRef?.trim() ?? "";
    if (ref === "" || ref.length > MAX_PRODUCT_REF_LENGTH || CONTROL_CHARACTERS.test(ref)) {
      reject("INVALID_FIELD", "a scanned item carries the product it was scanned as", "productRef");
    }
    productRef = ref;
  } else if (command.productRef !== undefined) {
    reject("INVALID_FIELD", "a manually added item has no scanned product", "productRef");
  }

  const bestBy = command.bestByDate ?? null;
  const bestByProvenance = command.bestByProvenance ?? null;
  if ((bestBy === null) !== (bestByProvenance === null)) {
    reject(
      "INVALID_FIELD",
      "bestByDate and bestByProvenance come together: a date needs its tier, and a tier needs its date",
      bestBy === null ? "bestByDate" : "bestByProvenance",
    );
  }
  let expiresAt: string | null = null;
  if (bestBy !== null) {
    const canonical = canonicalBestBy(bestBy);
    if (canonical === undefined) {
      reject(
        "INVALID_TIMESTAMP",
        "bestByDate must be an ISO-8601 date (YYYY-MM-DD) or an instant with an offset",
        "bestByDate",
      );
    }
    expiresAt = canonical;
  }

  return {
    ledgerKey: `${key}${PLAN_KEY_INFIX}0`,
    type: command.source === "BARCODE" ? "PURCHASE" : "INITIAL_STOCK",
    displayName,
    storageLocation: command.storageLocation,
    unit: command.unit,
    micros,
    tier: quantity.tier,
    provenanceSource:
      command.source === "BARCODE" ? BARCODE_SCAN_SOURCE : MANUAL_ENTRY_CREATE_SOURCE,
    productRef,
    expiresAt,
    expiryTier: bestByProvenance?.tier ?? null,
  };
}

/** The stored creation a key points at, if any. */
interface StoredCreation {
  readonly item_id: string;
  readonly sequence: number;
  readonly type: string;
  readonly qty_delta_micros: string;
  readonly unit: string;
  readonly provenance_tier: string;
  readonly provenance_source: string;
  readonly actor_user_id: string | null;
  readonly display_name: string | null;
  readonly storage_location: string | null;
  readonly product_ref: string | null;
  readonly expires_at: Date | null;
  readonly expiry_tier: string | null;
}

async function findByKey(
  client: ClientBase,
  householdId: string,
  ledgerKey: string,
): Promise<StoredCreation | undefined> {
  const found = await client.query<StoredCreation>(
    `SELECT t.item_id, t.sequence, t.type, t.qty_delta_micros::text AS qty_delta_micros, t.unit,
            t.provenance_tier, t.provenance_source, t.actor_user_id,
            i.display_name, i.storage_location, i.product_ref,
            l.expires_at, l.expiry_tier
       FROM inventory_transactions AS t
       JOIN inventory_items AS i ON i.household_id = t.household_id AND i.id = t.item_id
       JOIN inventory_lots AS l
         ON l.household_id = t.household_id AND l.item_id = t.item_id AND l.id = t.lot_id
      WHERE t.household_id = $1 AND t.idempotency_key = $2`,
    [householdId, ledgerKey],
  );
  return found.rows[0];
}

/** True when the stored creation is exactly what this request describes. */
function sameCreation(
  stored: StoredCreation,
  planned: PlannedCreation,
  actorUserId: string,
): boolean {
  const storedExpiry = stored.expires_at === null ? null : stored.expires_at.toISOString();
  return (
    stored.sequence === 1 &&
    stored.type === planned.type &&
    BigInt(stored.qty_delta_micros) === planned.micros &&
    stored.unit === planned.unit &&
    stored.provenance_tier === planned.tier &&
    stored.provenance_source === planned.provenanceSource &&
    stored.actor_user_id === actorUserId &&
    stored.display_name === planned.displayName &&
    stored.storage_location === planned.storageLocation &&
    stored.product_ref === planned.productRef &&
    storedExpiry === planned.expiresAt &&
    stored.expiry_tier === planned.expiryTier
  );
}

async function summaryOf(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<InventoryItemSummaryDto> {
  const read = await readInventoryItemDetail(client, householdId, itemId);
  if (read === undefined) throw new InventoryItemNotVisibleError();
  return read.detail.summary;
}

/**
 * Creates the item, its lot and its first row, or replays an earlier identical
 * create. Must run inside a household-scoped write transaction
 * (`TenantSessionRunner.write`), which is also what makes a retried attempt
 * safe: the key lookup happens inside, so a retry finds its own earlier work.
 */
export async function createInventoryItemWithStock(
  client: ClientBase,
  householdId: string,
  command: CreateItemCommand,
  ids: NewItemIds,
): Promise<CreateItemResult> {
  const planned = planCreation(command);

  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `inventory-create:${householdId}:${planned.ledgerKey}`,
  ]);

  const stored = await findByKey(client, householdId, planned.ledgerKey);
  if (stored !== undefined) {
    if (!sameCreation(stored, planned, command.actorUserId)) {
      reject(
        "IDEMPOTENCY_KEY_CONFLICT",
        "idempotencyKey was already used for a different change in this household",
        "idempotencyKey",
      );
    }
    return { summary: await summaryOf(client, householdId, stored.item_id), replayed: true };
  }

  const created = await insertInventoryItem(
    client,
    {
      itemId: ids.itemId,
      householdId,
      unit: planned.unit,
      storageLocation: planned.storageLocation,
      ...(planned.productRef === null ? {} : { productRef: planned.productRef }),
      lots: [
        {
          lotId: ids.lotId,
          acquiredAt: command.recordedAt,
          ...(planned.expiresAt === null ? {} : { expiresAt: planned.expiresAt }),
          ...(planned.expiryTier === null ? {} : { expiryTier: planned.expiryTier }),
        },
      ],
    },
    planned.displayName,
  );
  if (!created.ok) throw new LedgerWriteRejectedError(created.error);

  const input: TransactionInput = {
    lotId: ids.lotId,
    type: planned.type,
    qtyDelta: microsToAmount(planned.micros),
    unit: planned.unit,
    actor: { kind: "user", userId: command.actorUserId },
    occurredAt: command.recordedAt,
    recordedAt: command.recordedAt,
    provenance: { tier: planned.tier, source: planned.provenanceSource },
    idempotencyKey: planned.ledgerKey,
  };
  const appended = await appendTransactionToDb(client, householdId, ids.itemId, input);
  if (!appended.ok) throw new LedgerIntegrityError(appended.error);
  const result = appended.value;
  // A rejection here rolls back the item and the lot with it: the whole
  // transaction fails, so there is never an item without its row.
  if (result.status === "rejected") throw new LedgerWriteRejectedError(result.error);
  if (result.status !== "appended") {
    // A brand-new item has no rows for its key to duplicate.
    throw new LedgerIntegrityError(
      ledgerError("CORRUPT_LEDGER", "a new item reported an existing row for its key"),
    );
  }

  return { summary: await summaryOf(client, householdId, ids.itemId), replayed: false };
}
