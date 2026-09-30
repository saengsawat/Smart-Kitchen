/**
 * The Chen household's development shopping list (M7-T1 (f)).
 *
 * The prototype's member-origin rows, written into a real database so a
 * phone pointed at the API shows real rows on S11:
 *
 * - **Chicken breast**, need 2 lb, tied to the seeded chicken item. The seed
 *   stores the need only; the gap (0.75 lb against the 1.25 lb the ledger
 *   holds) is computed on every read by the domain's `neededQuantity`, so it
 *   is never a number written here. The prototype draws this row as a menu
 *   gap; menu rows do not exist yet (D-020, D-024), so it is Dean's own add.
 * - **Paper towels**, 1 each, added by Maya, no item (Add hands it to S9).
 * - **Olive oil**, 1 each, added and checked off by Dean, no item.
 *
 * Same rules as the inventory seed: runs as `sk_app` inside the household's
 * own context, so a seeded row can never need a privilege the API lacks;
 * ids are derived, so a re-run inserts nothing (`ON CONFLICT DO NOTHING` on
 * the primary key) and a row a person has since checked, added or removed is
 * left exactly as they left it; only inserts, never an update or a delete.
 * The production refusal is `seed-fixture.ts`'s, before anything connects.
 */

import type { Pool, PoolClient } from "pg";
import { withHouseholdTransaction } from "../db/session.js";
import { SK_APP_ROLE } from "../http/tenant-session.js";
import { fixtureSeedUuid } from "./fixture-ids.js";
import { seedItemId } from "./fixture-inventory.js";

/** When the seeded olive oil was checked off: fixed, like every seeded instant. */
export const OLIVE_OIL_CHECKED_OFF_AT = "2026-09-21T17:30:00.000Z";

interface SeedShoppingRow {
  readonly key: string;
  readonly name: string;
  readonly group: string;
  readonly origin: "dean" | "maya";
  readonly needMicros: bigint;
  readonly unit: string;
  /** Key of the seeded inventory item this row purchases into, if any. */
  readonly itemKey?: string;
  readonly defaultLocation: "FRIDGE" | "FREEZER" | "PANTRY" | "OTHER";
  /** Checked off by this member at {@link OLIVE_OIL_CHECKED_OFF_AT}. */
  readonly checkedOffBy?: "dean";
}

/** In list order: the read orders by `created_at`, and each row is its own statement. */
export const CHEN_SEED_SHOPPING_ROWS: readonly SeedShoppingRow[] = [
  {
    key: "chicken",
    name: "Chicken breast",
    group: "Meat & seafood",
    origin: "dean",
    needMicros: 2_000_000n,
    unit: "lb",
    itemKey: "chicken",
    defaultLocation: "FRIDGE",
  },
  {
    key: "paper-towels",
    name: "Paper towels",
    group: "Pantry",
    origin: "maya",
    needMicros: 1_000_000n,
    unit: "each",
    defaultLocation: "PANTRY",
  },
  {
    key: "olive-oil",
    name: "Olive oil",
    group: "Pantry",
    origin: "dean",
    needMicros: 1_000_000n,
    unit: "each",
    defaultLocation: "PANTRY",
    checkedOffBy: "dean",
  },
];

export function seedShoppingRowId(rowKey: string): string {
  return fixtureSeedUuid(`shopping-row:${rowKey}`);
}

export interface SeedShoppingSummary {
  readonly rowsCreated: number;
  readonly rowsAlreadyPresent: number;
}

export interface ChenShoppingMembers {
  readonly deanUserId: string;
  readonly mayaUserId: string;
}

async function membershipId(
  client: PoolClient,
  householdId: string,
  userId: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM household_memberships WHERE household_id = $1 AND user_id = $2",
    [householdId, userId],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("seed: a Chen shopping row names a member the household does not have");
  }
  return id;
}

/**
 * Writes the Chen rows, skipping any already there. The inventory seed must
 * run first: the chicken row's item is a foreign key.
 */
export async function seedChenShopping(
  pool: Pool,
  householdId: string,
  users: ChenShoppingMembers,
): Promise<SeedShoppingSummary> {
  return withHouseholdTransaction(
    pool,
    householdId,
    async (client) => {
      const members = {
        dean: {
          userId: users.deanUserId,
          memberId: await membershipId(client, householdId, users.deanUserId),
        },
        maya: {
          userId: users.mayaUserId,
          memberId: await membershipId(client, householdId, users.mayaUserId),
        },
      };
      let rowsCreated = 0;
      for (const row of CHEN_SEED_SHOPPING_ROWS) {
        const origin = members[row.origin];
        const checker = row.checkedOffBy === undefined ? undefined : members[row.checkedOffBy];
        const inserted = await client.query(
          `INSERT INTO shopping_rows
             (id, household_id, name, group_label, origin_kind, origin_member_id, need_micros,
              unit, item_id, default_location, status, checked_off_by, checked_off_at, created_by)
           VALUES ($1, $2, $3, $4, 'member', $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (id) DO NOTHING`,
          [
            seedShoppingRowId(row.key),
            householdId,
            row.name,
            row.group,
            origin.memberId,
            row.needMicros.toString(),
            row.unit,
            row.itemKey === undefined ? null : seedItemId(row.itemKey),
            row.defaultLocation,
            checker === undefined ? "open" : "done",
            checker?.memberId ?? null,
            checker === undefined ? null : OLIVE_OIL_CHECKED_OFF_AT,
            origin.userId,
          ],
        );
        rowsCreated += inserted.rowCount ?? 0;
      }
      return { rowsCreated, rowsAlreadyPresent: CHEN_SEED_SHOPPING_ROWS.length - rowsCreated };
    },
    { assumeRole: SK_APP_ROLE },
  );
}
