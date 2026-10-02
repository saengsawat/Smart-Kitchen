/**
 * Confirming an AI proposal (M2-T5, D-028).
 *
 * A member says "that reading is right" about an item whose quantity came from
 * an AI interpretation (today, the seeded receipt reads). One request becomes
 * one database transaction:
 *
 *   validate the key -> lock the item -> refuse an item with no AI row at all
 *   -> record a confirmation for every AI row not yet confirmed -> read the
 *   item back
 *
 * What it never does: touch the ledger. The rows it confirms stay exactly as
 * they were written (INV-LEDGER-2, ADR-008); the confirmation is its own row in
 * `inventory_confirmations`, and the reads present a confirmed row as
 * KNOWN_FACT. No quantity is read for a decision or written, so there is no
 * arithmetic here to get wrong (CLAUDE.md rule 7), and no model is consulted
 * anywhere on this path.
 *
 * Idempotent by state, not by key. A second confirm, with the same key or a
 * different one, finds nothing left to confirm, inserts nothing and answers the
 * same body as the first, because the body is the item as stored and nothing
 * about the item changed. The key is recorded on each confirmation row for the
 * audit trail only.
 *
 * The `ai-confirmed` actor kind is deliberately not used: that kind belongs on
 * a ledger row a future AI flow inserts after a confirmation, and this path
 * inserts no ledger row (D-028). The confirming person is `confirmed_by`.
 */

import type { InventoryItemDetailDto } from "@smart-kitchen/contracts";
import { ledgerError } from "@smart-kitchen/domain";
import type { ClientBase } from "pg";
import { CLIENT_KEY } from "../db/inventory/client-key.js";
import {
  countAiInterpretedTransactions,
  insertMissingConfirmations,
  lockItemForConfirmation,
} from "../db/inventory/confirmations.js";
import { readInventoryItemDetail } from "../db/inventory/detail.js";
import {
  InventoryItemNotVisibleError,
  LedgerWriteRejectedError,
} from "../db/inventory/write-service.js";

/** What the caller asked for, with identity already resolved from the session. */
export interface ConfirmAiProposalCommand {
  readonly clientKey: string;
  /** The session's user. Never a request field (INV-TENANT-1). */
  readonly actorUserId: string;
}

export interface ConfirmAiProposalResult {
  readonly detail: InventoryItemDetailDto;
  /** Ledger rows this call confirmed, in ledger order. Empty on a replay. For the log line only. */
  readonly confirmedTransactionIds: readonly string[];
}

/**
 * The item has no AI-interpreted ledger row at all, so there is no proposal to
 * confirm (409 `NOT_A_PROPOSAL`). An item whose AI rows are all confirmed
 * already is not this case: that is the idempotent replay.
 */
export class NotAProposalError extends Error {
  constructor() {
    super("the item has no AI-interpreted ledger row to confirm");
    this.name = "NotAProposalError";
  }
}

/**
 * Confirms every not-yet-confirmed AI_INTERPRETATION row of the item.
 *
 * `client` must already be inside the caller's tenant write transaction for
 * `householdId`. Every refusal throws, so the transaction rolls back and a
 * refused confirm leaves nothing behind.
 */
export async function confirmAiProposal(
  client: ClientBase,
  householdId: string,
  itemId: string,
  command: ConfirmAiProposalCommand,
): Promise<ConfirmAiProposalResult> {
  if (!CLIENT_KEY.test(command.clientKey)) {
    throw new LedgerWriteRejectedError(
      ledgerError(
        "INVALID_IDEMPOTENCY_KEY",
        "clientKey must be 1 to 128 characters of letters, digits, dot, underscore or hyphen",
        "clientKey",
      ),
    );
  }

  if (!(await lockItemForConfirmation(client, householdId, itemId))) {
    throw new InventoryItemNotVisibleError();
  }

  if ((await countAiInterpretedTransactions(client, householdId, itemId)) === 0) {
    throw new NotAProposalError();
  }

  const confirmedTransactionIds = await insertMissingConfirmations(
    client,
    householdId,
    itemId,
    command.actorUserId,
    command.clientKey,
  );

  const read = await readInventoryItemDetail(client, householdId, itemId);
  // Locked a moment ago in this same transaction, so it cannot have vanished.
  if (read === undefined) throw new InventoryItemNotVisibleError();
  return { detail: read.detail, confirmedTransactionIds };
}
