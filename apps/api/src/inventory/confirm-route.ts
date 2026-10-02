/**
 * `POST /v1/inventory/items/{itemId}/confirm` (M2-T5, D-028).
 *
 * A household route, any member: S4's "Confirm" on an AI-tier row. The same
 * rules as every route in `http/routes.ts`:
 *
 * - the caller and the household come from the session, never the request;
 *   the body names only a client key, and an unknown property is refused, not
 *   stripped (`removeAdditional: false`, `app.ts`);
 * - **404** for an item this session cannot see, whether it is another
 *   household's or does not exist, decided before anything is written;
 * - a refusal answers a code and a fixed sentence, never an internal message.
 *
 * Answers:
 *
 * - **200** with the item as it now stands (summary and history, the
 *   confirmed rows presenting as KNOWN_FACT). A second confirm, under any key,
 *   answers the same 200 with the same body and records nothing;
 * - **409 `NOT_A_PROPOSAL`** for an item with no AI-interpreted ledger row at
 *   all;
 * - **400** with `ledgerCode: INVALID_IDEMPOTENCY_KEY` for a key outside the
 *   one client-key shape (M9-T0), the same answer the write path gives.
 *
 * `http/routes.ts` declares the route by calling {@link registerConfirmRoute};
 * the handler and its service live here (BACKLOG.md M2-T5 file scope).
 */

import {
  INVENTORY_ITEM_CONFIRM_ROUTE,
  type ApiErrorBodyDto,
  type ConfirmAiProposalRequestDto,
  type ConfirmAiProposalResponseDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  InventoryItemNotVisibleError,
  LedgerWriteRejectedError,
} from "../db/inventory/write-service.js";
import { householdRoute, requireSession } from "../http/authorization.js";
import { ledgerErrorResponse, notVisibleResponse } from "../http/ledger-errors.js";
import type { TenantSessionRunner } from "../http/tenant-session.js";
import { confirmAiProposal, NotAProposalError } from "./confirm-service.js";

export interface ConfirmRouteDeps {
  readonly tenantSession: TenantSessionRunner;
}

/** Path parameters are `uuid` columns; anything else names no row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Body by shape only; the key's character rule is the service's, so it answers a ledger code. */
const CONFIRM_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idempotencyKey"],
  properties: {
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

/**
 * The sentence for `NOT_A_PROPOSAL`. The client never shows it (no server
 * message reaches a screen); S4 only offers Confirm on an AI-tier row, so this
 * answer means the screen was stale.
 */
export const NOT_A_PROPOSAL_MESSAGE = "That item has nothing waiting for confirmation.";

function routePath(request: FastifyRequest): string {
  return request.routeOptions.url ?? "(no route)";
}

function notAProposalBody(correlationId: string): ApiErrorBodyDto {
  return { error: { code: "NOT_A_PROPOSAL", message: NOT_A_PROPOSAL_MESSAGE, correlationId } };
}

/**
 * A confirm failure as its answer. Anything unrecognised is rethrown for the
 * app-level handler: a 500 with a generic body, never a guess.
 */
async function answerFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): Promise<undefined> {
  if (error instanceof InventoryItemNotVisibleError) {
    await reply.code(404).send(notVisibleResponse(request.id));
    return undefined;
  }
  if (error instanceof NotAProposalError) {
    request.log.info({ routePath: routePath(request) }, "inventory.confirm.not-a-proposal");
    await reply.code(409).send(notAProposalBody(request.id));
    return undefined;
  }
  if (error instanceof LedgerWriteRejectedError) {
    const answer = ledgerErrorResponse(error.ledgerError, request.id);
    request.log.info(
      {
        routePath: routePath(request),
        ledgerCode: error.ledgerError.code,
        field: error.ledgerError.field ?? null,
      },
      "inventory.confirm.refused",
    );
    await reply.code(answer.statusCode).send(answer.body);
    return undefined;
  }
  throw error;
}

export function registerConfirmRoute(app: FastifyInstance, deps: ConfirmRouteDeps): void {
  app.post(
    INVENTORY_ITEM_CONFIRM_ROUTE,
    { config: { authorization: householdRoute() }, schema: { body: CONFIRM_BODY_SCHEMA } },
    async (request, reply): Promise<ConfirmAiProposalResponseDto | undefined> => {
      const session = requireSession(request);
      const { itemId } = request.params as { itemId: string };
      if (!UUID.test(itemId)) {
        await reply.code(404).send(notVisibleResponse(request.id));
        return undefined;
      }
      const body = request.body as ConfirmAiProposalRequestDto;

      try {
        const result = await deps.tenantSession.write(session, (client) =>
          confirmAiProposal(client, session.householdId, itemId, {
            idempotencyKey: body.idempotencyKey,
            // The confirming person is the session, always. There is no request field for it.
            actorUserId: session.userId,
          }),
        );
        // What happened, never who or what was confirmed.
        request.log.info(
          {
            routePath: routePath(request),
            rows: result.confirmedTransactionIds.length,
            replayed: result.confirmedTransactionIds.length === 0,
          },
          "inventory.confirm.applied",
        );
        return { item: result.detail };
      } catch (error) {
        return answerFailure(request, reply, error);
      }
    },
  );
}
