/**
 * The statements behind confirming an AI proposal (M2-T5, D-028).
 *
 * Exactly what a confirmation writes, and nothing else:
 *
 * - **one row in `inventory_confirmations` per `AI_INTERPRETATION` ledger row of
 *   the item that has no confirmation yet**: `household_id`, `item_id` and
 *   `transaction_id` copied from the ledger row, `confirmed_by` the session's
 *   user, `model_ref` the ledger row's own `provenance_model_ref`, `client_key`
 *   the request's key, `id` and `confirmed_at` from their defaults;
 * - **no other table**: no ledger row, no item or lot column, no quantity. The
 *   item lock below is a `SELECT … FOR UPDATE`, which writes nothing.
 *
 * Every statement is household-filtered in the SQL, inside the caller's tenant
 * transaction, with the 0010 policy as the independent second layer, the same
 * two-layer rule as every other module under `src/db`.
 */

import type { ClientBase } from "pg";

/**
 * Takes the item's write lock. `false` when the item is not visible to this
 * session (no such item, or another household's: deliberately the same answer).
 *
 * The same lock every ledger write takes first (`write-service.ts`), so a
 * confirm and a concurrent append to the same item are serialised: the set of
 * AI rows a confirm sees cannot change under it, and two concurrent confirms
 * cannot both decide a row is still unconfirmed (the unique key is the
 * backstop behind that).
 */
export async function lockItemForConfirmation(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<boolean> {
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM inventory_items WHERE id = $1 AND household_id = $2 FOR UPDATE`,
    [itemId, householdId],
  );
  return locked.rows.length > 0;
}

/** How many of the item's ledger rows carry the AI_INTERPRETATION tier. */
export async function countAiInterpretedTransactions(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM inventory_transactions
      WHERE household_id = $1
        AND item_id = $2
        AND provenance_tier = 'AI_INTERPRETATION'`,
    [householdId, itemId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

/**
 * Records a confirmation for every AI_INTERPRETATION row of the item that has
 * none yet, in one statement, and returns the ledger row ids it confirmed (in
 * ledger order). Empty when there was nothing left to confirm, which is the
 * idempotent replay.
 *
 * `ON CONFLICT DO NOTHING` on the household-scoped unique key is the backstop
 * behind the `NOT EXISTS` and the item lock, never the primary mechanism: with
 * the lock held, no other transaction can have confirmed one of these rows
 * since the `NOT EXISTS` was evaluated.
 */
export async function insertMissingConfirmations(
  client: ClientBase,
  householdId: string,
  itemId: string,
  confirmedBy: string,
  clientKey: string,
): Promise<string[]> {
  const result = await client.query<{ transaction_id: string }>(
    `WITH inserted AS (
       INSERT INTO inventory_confirmations
              (household_id, item_id, transaction_id, confirmed_by, model_ref, client_key)
       SELECT t.household_id, t.item_id, t.id, $3, NULLIF(btrim(t.provenance_model_ref), ''), $4
         FROM inventory_transactions AS t
        WHERE t.household_id = $1
          AND t.item_id = $2
          AND t.provenance_tier = 'AI_INTERPRETATION'
          AND NOT EXISTS (
                SELECT 1 FROM inventory_confirmations AS c
                 WHERE c.household_id = t.household_id
                   AND c.transaction_id = t.id)
        ORDER BY t.sequence
       ON CONFLICT (household_id, transaction_id) DO NOTHING
       RETURNING transaction_id
     )
     SELECT i.transaction_id
       FROM inserted AS i
       JOIN inventory_transactions AS t
         ON t.household_id = $1 AND t.id = i.transaction_id
      ORDER BY t.sequence`,
    [householdId, itemId, confirmedBy, clientKey],
  );
  return result.rows.map((row) => row.transaction_id);
}
