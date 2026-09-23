/**
 * The Chen household's development inventory (M2-T2).
 *
 * This is `apps/mobile/src/inventory/fixture-household.ts` written into a real
 * database, so that Dean's phone can point at a running API and see the
 * inventory the prototype shows, then write to it for real.
 *
 * **The client fixture is the source of truth for the data.** Items, lots,
 * units, quantities, tiers, sources and timestamps are copied from it. They are
 * copied rather than imported because `apps/api` does not depend on
 * `apps/mobile` and must not start: the client is an application, not a
 * library, and an import edge between two applications is the kind of thing
 * that quietly becomes a build dependency. The cost is that the two can drift,
 * so `fixture-inventory.test.ts` pins the totals the client's own tests assert.
 *
 * **The ledger is the source of truth for the history.** Nothing here writes a
 * quantity: every row goes through `appendTransactionToDb`, so the snapshots
 * are the trigger's, and the chicken breast's clamp row is the ledger's own
 * (append 2.0, use 2.25 in the stir-fry, append 1.25, and the ledger appends
 * the 0.25 correction it decided on). Seeding a clamp as data would have been
 * a fake of the one row whose whole meaning is that the system wrote it.
 *
 * Three honest differences from the client fixture, none of them in a quantity:
 *
 * 1. **Lots are real.** The chicken's two purchases are two acquisitions, so
 *    the seeded item has the drained Wednesday lot as well as the Saturday one
 *    the prototype draws; a multi-lot item (yogurt, salmon) gets one opening
 *    row per lot instead of one row for the total, because a lot's balance has
 *    to come from rows against that lot.
 * 2. **No correlation label.** The prototype captions the stir-fry row with a
 *    recipe name; the schema stores a correlation *kind and id*, and there are
 *    no meal-log rows to point at yet (M6/M8). An id column holding a display
 *    string would be a lie about what the column means, so the row carries none.
 * 3. **Timestamps are fixed, not relative to today.** The client fixture pins
 *    `FIXTURE_NOW` for determinism and so does this, because a seed whose
 *    timestamps move is a seed that cannot be re-run without conflicting with
 *    itself under the same idempotency keys.
 */

import {
  microsToAmount,
  type Instant,
  type ProvenanceTier,
  type StorageLocation,
  type TransactionType,
} from "@smart-kitchen/domain";
import type { Pool, PoolClient } from "pg";
import { appendTransactionToDb, insertInventoryItem } from "../db/inventory/repository.js";
import { withHouseholdTransaction } from "../db/session.js";
import { SK_APP_ROLE } from "../http/tenant-session.js";
import { fixtureSeedUuid } from "./fixture-ids.js";

/** The client fixture's fixed "now" (`FIXTURE_NOW`), so expiries line up. */
export const FIXTURE_NOW = "2026-09-22T12:00:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Instant {
  return new Date(new Date(FIXTURE_NOW).getTime() + days * DAY_MS).toISOString();
}

interface SeedLot {
  readonly key: string;
  readonly label?: string;
  readonly acquiredAt?: Instant;
  readonly expiresAt?: Instant;
  readonly expiryTier?: ProvenanceTier;
}

interface SeedRow {
  readonly lotKey: string;
  readonly type: TransactionType;
  /** Signed, exact micro-units. A decrease that overshoots is meant to. */
  readonly deltaMicros: bigint;
  readonly at: Instant;
  /** `undefined` means the row is the system's own opening statement. */
  readonly actorUser?: "dean";
  readonly tier: ProvenanceTier;
  readonly source: string;
}

interface SeedItem {
  readonly key: string;
  readonly displayName: string;
  readonly storageLocation: StorageLocation;
  readonly unit: string;
  readonly lots: readonly SeedLot[];
  readonly rows: readonly SeedRow[];
}

/** Component recorded as the actor on the opening rows the seed itself writes. */
const SEED_COMPONENT = "fixture-seed";

/** One opening statement for a lot, as the client fixture records it. */
function opening(lotKey: string, micros: bigint, tier: ProvenanceTier, source: string): SeedRow {
  return {
    lotKey,
    type: "INITIAL_STOCK",
    deltaMicros: micros,
    at: daysFromNow(-30),
    tier,
    source,
  };
}

export const CHEN_SEED_ITEMS: readonly SeedItem[] = [
  {
    key: "strawberries",
    displayName: "Strawberries",
    storageLocation: "FRIDGE",
    unit: "lb",
    lots: [{ key: "lot-1", expiresAt: daysFromNow(1), expiryTier: "ESTIMATED" }],
    rows: [opening("lot-1", 1_000_000n, "AI_INTERPRETATION", "receipt read “ORG STRWB 1LB”")],
  },
  {
    key: "chicken",
    displayName: "Chicken breast",
    storageLocation: "FRIDGE",
    unit: "lb",
    lots: [
      { key: "lot-1", acquiredAt: "2026-09-16T18:04:00.000Z" },
      {
        key: "lot-2",
        label: "bought Sat",
        acquiredAt: daysFromNow(-3),
        expiresAt: daysFromNow(2),
        expiryTier: "KNOWN_FACT",
      },
    ],
    rows: [
      {
        lotKey: "lot-1",
        type: "PURCHASE",
        deltaMicros: 2_000_000n,
        at: "2026-09-16T18:04:00.000Z",
        actorUser: "dean",
        tier: "KNOWN_FACT",
        source: "scanned barcode",
      },
      {
        // 2.25 lb recorded against a lot holding 2.0: the ledger appends its
        // own 0.25 correction after this row. That clamp is the point of the
        // worked example, and it is not written here.
        lotKey: "lot-1",
        type: "USE_IN_MEAL",
        deltaMicros: -2_250_000n,
        at: "2026-09-17T19:20:00.000Z",
        actorUser: "dean",
        tier: "KNOWN_FACT",
        source: "cook confirm, FEFO plan",
      },
      {
        lotKey: "lot-2",
        type: "PURCHASE",
        deltaMicros: 1_250_000n,
        at: "2026-09-19T17:40:00.000Z",
        actorUser: "dean",
        tier: "KNOWN_FACT",
        source: "scanned barcode",
      },
    ],
  },
  {
    key: "spinach",
    displayName: "Spinach",
    storageLocation: "FRIDGE",
    unit: "oz",
    lots: [{ key: "lot-1", expiresAt: daysFromNow(3), expiryTier: "KNOWN_FACT" }],
    rows: [opening("lot-1", 5_000_000n, "KNOWN_FACT", "scanned barcode")],
  },
  {
    key: "mushrooms",
    displayName: "Mushrooms",
    storageLocation: "FRIDGE",
    unit: "oz",
    lots: [{ key: "lot-1", expiresAt: daysFromNow(3), expiryTier: "ESTIMATED" }],
    rows: [opening("lot-1", 8_000_000n, "AI_INTERPRETATION", "receipt read “CREMINI MUSHRM 8OZ”")],
  },
  {
    key: "yogurt",
    displayName: "Greek yogurt",
    storageLocation: "FRIDGE",
    unit: "oz",
    lots: [
      { key: "lot-1", expiresAt: daysFromNow(10), expiryTier: "KNOWN_FACT" },
      { key: "lot-2", expiresAt: daysFromNow(10), expiryTier: "KNOWN_FACT" },
      { key: "lot-3", expiresAt: daysFromNow(10), expiryTier: "KNOWN_FACT" },
    ],
    rows: [
      opening("lot-1", 16_000_000n, "KNOWN_FACT", "scanned barcode"),
      opening("lot-2", 16_000_000n, "KNOWN_FACT", "scanned barcode"),
      opening("lot-3", 16_000_000n, "KNOWN_FACT", "scanned barcode"),
    ],
  },
  {
    key: "eggs",
    displayName: "Eggs",
    storageLocation: "FRIDGE",
    unit: "count",
    lots: [
      {
        key: "lot-1",
        label: "carton of 12",
        expiresAt: daysFromNow(14),
        expiryTier: "KNOWN_FACT",
      },
    ],
    rows: [opening("lot-1", 8_000_000n, "KNOWN_FACT", "scanned barcode")],
  },
  {
    key: "salmon",
    displayName: "Salmon fillets",
    storageLocation: "FREEZER",
    unit: "oz",
    lots: [
      { key: "lot-1", expiresAt: daysFromNow(60), expiryTier: "KNOWN_FACT" },
      { key: "lot-2", expiresAt: daysFromNow(60), expiryTier: "KNOWN_FACT" },
    ],
    rows: [
      opening("lot-1", 6_000_000n, "KNOWN_FACT", "scanned barcode"),
      opening("lot-2", 6_000_000n, "KNOWN_FACT", "scanned barcode"),
    ],
  },
  {
    key: "rice",
    displayName: "Basmati rice",
    storageLocation: "PANTRY",
    unit: "cup",
    lots: [{ key: "lot-1" }],
    rows: [opening("lot-1", 4_000_000n, "ESTIMATED", "estimated from meals logged")],
  },
  {
    key: "olive-oil",
    displayName: "Olive oil",
    storageLocation: "PANTRY",
    unit: "bottle",
    lots: [{ key: "lot-1", label: "opened Aug 30" }],
    rows: [opening("lot-1", 1_000_000n, "KNOWN_FACT", "manual entry")],
  },
];

/** What one run of the seed did. */
export interface SeedInventorySummary {
  readonly itemsCreated: number;
  readonly itemsAlreadyPresent: number;
  readonly rowsAppended: number;
}

export function seedItemId(itemKey: string): string {
  return fixtureSeedUuid(`item:${itemKey}`);
}

export function seedLotId(itemKey: string, lotKey: string): string {
  return fixtureSeedUuid(`lot:${itemKey}:${lotKey}`);
}

/** Ledger key for one seeded row. Stable, so a re-run replays instead of doubling. */
export function seedRowKey(itemKey: string, index: number): string {
  return `fixture-seed.${itemKey}.${String(index)}`;
}

/**
 * Writes the Chen inventory, skipping any item that already exists.
 *
 * Runs as `sk_app`, so the seed can only write what the API itself could write:
 * if a seeded row needed a privilege the running application does not have,
 * that would be a sign the fixture is not a fixture of this system. The
 * identities must already exist (`seedFixtureIdentities`), because every actor
 * is a real `users` row and the foreign keys say so. That identity half runs as
 * the *connecting* role, which therefore has to be the owner or a superuser:
 * `sk_app` holds only SELECT on `households` and could not write it.
 *
 * **One transaction per item**, not one for the run. An item with half its
 * ledger would be wrong, so the item, its lots and its rows commit together;
 * an item that has not been written yet is simply not seeded yet, and the
 * existence check picks it up on the next run. That also gives each item a
 * distinct `created_at`, which is what the list endpoint orders by, so the
 * seeded inventory comes back in the order the prototype draws it rather than
 * in the arbitrary order of derived uuids (`now()` is the *transaction*
 * timestamp, so a single transaction would stamp all nine identically).
 */
export async function seedChenInventory(
  pool: Pool,
  householdId: string,
  deanUserId: string,
): Promise<SeedInventorySummary> {
  let itemsCreated = 0;
  let itemsAlreadyPresent = 0;
  let rowsAppended = 0;

  for (const item of CHEN_SEED_ITEMS) {
    const written = await withHouseholdTransaction(
      pool,
      householdId,
      async (client) => seedOneItem(client, householdId, deanUserId, item),
      { assumeRole: SK_APP_ROLE },
    );
    if (written === undefined) {
      itemsAlreadyPresent += 1;
      continue;
    }
    itemsCreated += 1;
    rowsAppended += written;
  }

  return { itemsCreated, itemsAlreadyPresent, rowsAppended };
}

/** Writes one item, or reports that it is already there. Returns rows appended. */
async function seedOneItem(
  client: PoolClient,
  householdId: string,
  deanUserId: string,
  item: SeedItem,
): Promise<number | undefined> {
  const itemId = seedItemId(item.key);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM inventory_items WHERE id = $1 AND household_id = $2`,
    [itemId, householdId],
  );
  if (existing.rows.length > 0) return undefined;

  const created = await insertInventoryItem(
    client,
    {
      itemId,
      householdId,
      unit: item.unit,
      storageLocation: item.storageLocation,
      lots: item.lots.map((lot) => ({
        lotId: seedLotId(item.key, lot.key),
        ...(lot.acquiredAt === undefined ? {} : { acquiredAt: lot.acquiredAt }),
        ...(lot.expiresAt === undefined ? {} : { expiresAt: lot.expiresAt }),
        ...(lot.expiryTier === undefined ? {} : { expiryTier: lot.expiryTier }),
        ...(lot.label === undefined ? {} : { label: lot.label }),
      })),
    },
    item.displayName,
  );
  if (!created.ok) {
    throw new Error(`seed: ${item.key} was refused by the domain: ${created.error.message}`);
  }

  let rowsAppended = 0;
  for (const [index, row] of item.rows.entries()) {
    const outcome = await appendTransactionToDb(client, householdId, itemId, {
      lotId: seedLotId(item.key, row.lotKey),
      type: row.type,
      // The domain's own exact conversion, never a float division.
      qtyDelta: microsToAmount(row.deltaMicros),
      unit: item.unit,
      actor:
        row.actorUser === undefined
          ? { kind: "system", component: SEED_COMPONENT }
          : { kind: "user", userId: deanUserId },
      occurredAt: row.at,
      recordedAt: row.at,
      provenance: { tier: row.tier, source: row.source },
      idempotencyKey: seedRowKey(item.key, index),
    });
    if (!outcome.ok) {
      throw new Error(`seed: ${item.key} row ${String(index)}: ${outcome.error.message}`);
    }
    const result = outcome.value;
    if (result.status === "rejected") {
      throw new Error(
        `seed: ${item.key} row ${String(index)} rejected: ${result.error.code} ${result.error.message}`,
      );
    }
    if (result.status === "appended") {
      rowsAppended += 1 + (result.clampAdjustment === undefined ? 0 : 1);
    }
  }

  return rowsAppended;
}
