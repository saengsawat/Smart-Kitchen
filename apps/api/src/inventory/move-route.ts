/**
 * `POST /v1/inventory/items/{itemId}/move` (M2-T6, D-024 row 1).
 *
 * A household route, any member: S5's "Move to" chip. The same rules as every
 * route in `http/routes.ts`:
 *
 * - the caller and the household come from the session, never the request; the
 *   body names only a destination and a key, and an unknown property is
 *   refused, not stripped (`removeAdditional: false`, `app.ts`);
 * - **404** for an item this session cannot see, whether it is another
 *   household's or does not exist, decided before anything is written;
 * - a refusal answers a code and a fixed sentence, never an internal message.
 *
 * Answers:
 *
 * - **200** with the item as it now stands (new location, `MOVED` history
 *   entry). The same key and destination again answers the same 200 and
 *   records nothing;
 * - **409 `SAME_LOCATION`** when the destination is where the item already is
 *   (and the key is new);
 * - **409 `CONFLICT`** (`ledgerCode: IDEMPOTENCY_KEY_CONFLICT`) when the key
 *   was already used on this item for a different destination;
 * - **400** with `ledgerCode: INVALID_IDEMPOTENCY_KEY` for a key outside the
 *   one client-key shape, and 400 for a destination outside the four-value
 *   enum or an unknown body property.
 *
 * `http/routes.ts` declares the route by calling {@link registerMoveRoute}; the
 * handler and its service live here (BACKLOG.md M2-T6 file scope).
 */

import {
  INVENTORY_ITEM_MOVE_ROUTE,
  type ApiErrorBodyDto,
  type MoveItemRequestDto,
  type MoveItemResponseDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { STORAGE_LOCATIONS_DB } from "../db/inventory/moves.js";
import {
  InventoryItemNotVisibleError,
  LedgerWriteRejectedError,
} from "../db/inventory/write-service.js";
import { householdRoute, requireSession } from "../http/authorization.js";
import { ledgerErrorResponse, notVisibleResponse } from "../http/ledger-errors.js";
import type { TenantSessionRunner } from "../http/tenant-session.js";
import { moveItem, SameLocationError } from "./move-service.js";

export interface MoveRouteDeps {
  readonly tenantSession: TenantSessionRunner;
}

/** Path parameters are `uuid` columns; anything else names no row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Body by shape only; the key's character rule is the service's, so it answers a ledger code. */
const MOVE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["toLocation", "idempotencyKey"],
  properties: {
    toLocation: { type: "string", enum: [...STORAGE_LOCATIONS_DB] },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

/** The sentence for `SAME_LOCATION`. The client never shows it; S5 only offers the other locations. */
export const SAME_LOCATION_MESSAGE = "That item is already stored there.";

function routePath(request: FastifyRequest): string {
  return request.routeOptions.url ?? "(no route)";
}

function sameLocationBody(correlationId: string): ApiErrorBodyDto {
  return { error: { code: "SAME_LOCATION", message: SAME_LOCATION_MESSAGE, correlationId } };
}

/**
 * A move failure as its answer. Anything unrecognised is rethrown for the
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
  if (error instanceof SameLocationError) {
    request.log.info({ routePath: routePath(request) }, "inventory.move.same-location");
    await reply.code(409).send(sameLocationBody(request.id));
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
      "inventory.move.refused",
    );
    await reply.code(answer.statusCode).send(answer.body);
    return undefined;
  }
  throw error;
}

export function registerMoveRoute(app: FastifyInstance, deps: MoveRouteDeps): void {
  app.post(
    INVENTORY_ITEM_MOVE_ROUTE,
    { config: { authorization: householdRoute() }, schema: { body: MOVE_BODY_SCHEMA } },
    async (request, reply): Promise<MoveItemResponseDto | undefined> => {
      const session = requireSession(request);
      const { itemId } = request.params as { itemId: string };
      if (!UUID.test(itemId)) {
        await reply.code(404).send(notVisibleResponse(request.id));
        return undefined;
      }
      const body = request.body as MoveItemRequestDto;

      try {
        const result = await deps.tenantSession.write(session, (client) =>
          moveItem(client, session.householdId, itemId, {
            toLocation: body.toLocation,
            idempotencyKey: body.idempotencyKey,
            // The moving person is the session, always. There is no request field for it.
            actorUserId: session.userId,
          }),
        );
        // What happened, never which item or where.
        request.log.info(
          { routePath: routePath(request), replayed: !result.moved },
          "inventory.move.applied",
        );
        return { item: result.detail };
      } catch (error) {
        return answerFailure(request, reply, error);
      }
    },
  );
}
