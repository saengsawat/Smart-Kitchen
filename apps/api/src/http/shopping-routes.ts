/**
 * Shopping endpoints (M7-T1 (b) to (e)).
 *
 * | Route | Declaration | Answer |
 * | --- | --- | --- |
 * | `GET /v1/shopping` | `householdRoute` | 200 `ShoppingListDto` |
 * | `POST /v1/shopping/rows/{rowId}/check` | `householdRoute` | 200 `ShoppingRowDto` |
 * | `POST /v1/shopping/rows/{rowId}/add-to-inventory` | `householdRoute` | 201 appended, 200 replayed, `InventoryWriteResponseDto` |
 * | `POST /v1/shopping/rows/{rowId}/remove` | `householdRoute` | 204 |
 *
 * Any member of the household may do all four; no route is owner-only. The
 * same rules as every other route in this API:
 *
 * - the household and the actor come from the session, never the request;
 *   the bodies name no household, member, item or lot, and a body with an
 *   unknown property is refused (`additionalProperties: false`, with
 *   `removeAdditional` off in `app.ts`);
 * - a row this session cannot see (another household's, a removed one, or
 *   none) is one 404, the same body as an invisible inventory item;
 * - a refusal carries a code, never a domain message (`ledger-errors.ts`);
 * - the logs carry the route, the outcome and counts, never an idempotency
 *   key, a row name or a quantity.
 */

import {
  SHOPPING_PATH,
  SHOPPING_ROW_ADD_TO_INVENTORY_ROUTE,
  SHOPPING_ROW_CHECK_ROUTE,
  SHOPPING_ROW_REMOVE_ROUTE,
  type AddShoppingRowToInventoryRequestDto,
  type ApiErrorBodyDto,
  type CheckShoppingRowRequestDto,
  type InventoryWriteResponseDto,
  type ShoppingListDto,
  type ShoppingRowDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  InventoryItemNotVisibleError,
  LedgerWriteRejectedError,
} from "../db/inventory/write-service.js";
import {
  addShoppingRowToInventory,
  checkShoppingRow,
  readShoppingList,
  removeShoppingRow,
  ShoppingRowHasNoItemError,
  ShoppingRowNotCheckedOffError,
  ShoppingRowNotVisibleError,
} from "../db/shopping/service.js";
import { householdRoute, requireSession } from "./authorization.js";
import { ledgerErrorResponse, notVisibleResponse } from "./ledger-errors.js";
import type { TenantSessionRunner } from "./tenant-session.js";

export interface ShoppingRouteDeps {
  readonly tenantSession: TenantSessionRunner;
}

/** Row ids are `uuid` columns; anything else names no row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHECK_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["checked", "idempotencyKey"],
  properties: {
    // An `enum` with no `type`, on purpose. The instance keeps AJV's
    // `coerceTypes` on (`app.ts`, architect ruling at M2-T2), and coercion
    // applies only to a keyword with a `type`: `{ type: "boolean" }` would
    // turn `"true"` into true and, worse, `null`, `0` and `""` into false, so
    // a client bug sending `null` would uncheck a row. With a bare enum only
    // the two JSON booleans pass.
    checked: { enum: [true, false] },
    // The shape rule itself (letters, digits, dot, underscore, hyphen) is the
    // service's, so a bad key answers with the ledger code a screen can map.
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

const ADD_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idempotencyKey"],
  properties: {
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

/** The sentence for `ROW_HAS_NO_ITEM`; the client shows its own copy for it. */
export const ROW_HAS_NO_ITEM_MESSAGE =
  "That row isn't linked to an item yet, so it can't be added from the list.";

/** The sentence for an add on a row that is not checked off. */
export const ROW_NOT_CHECKED_OFF_MESSAGE = "Check the row off before adding it to inventory.";

/**
 * Remove takes no input: no body, `null` or `{}`, the same rule as the
 * join-code rotation (M2-T3 review F3). Anything else, such as a `rowId` or a
 * `householdId`, is a 400.
 */
function isEmptyBody(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  return typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
}

function errorBody(
  code: ApiErrorBodyDto["error"]["code"],
  message: string,
  correlationId: string,
): ApiErrorBodyDto {
  return { error: { code, message, correlationId } };
}

function routePath(request: FastifyRequest): string {
  return request.routeOptions.url ?? "(no route)";
}

async function notFound(request: FastifyRequest, reply: FastifyReply): Promise<undefined> {
  await reply.code(404).send(notVisibleResponse(request.id));
  return undefined;
}

/**
 * A write failure as its answer. Anything unrecognised is rethrown for the
 * app-level handler: a 500 with a generic body, never a guess.
 */
async function answerFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): Promise<undefined> {
  if (
    error instanceof ShoppingRowNotVisibleError ||
    error instanceof InventoryItemNotVisibleError
  ) {
    return notFound(request, reply);
  }
  if (error instanceof ShoppingRowHasNoItemError) {
    request.log.info({ routePath: routePath(request) }, "shopping.add.no-item");
    await reply.code(409).send(errorBody("ROW_HAS_NO_ITEM", ROW_HAS_NO_ITEM_MESSAGE, request.id));
    return undefined;
  }
  if (error instanceof ShoppingRowNotCheckedOffError) {
    request.log.info({ routePath: routePath(request) }, "shopping.add.not-checked-off");
    await reply.code(409).send(errorBody("CONFLICT", ROW_NOT_CHECKED_OFF_MESSAGE, request.id));
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
      "shopping.write.refused",
    );
    await reply.code(answer.statusCode).send(answer.body);
    return undefined;
  }
  throw error;
}

export function registerShoppingRoutes(app: FastifyInstance, deps: ShoppingRouteDeps): void {
  app.get(
    SHOPPING_PATH,
    { config: { authorization: householdRoute() } },
    async (request): Promise<ShoppingListDto> => {
      const session = requireSession(request);
      return deps.tenantSession.read(session, (client) =>
        readShoppingList(client, session.householdId),
      );
    },
  );

  app.post(
    SHOPPING_ROW_CHECK_ROUTE,
    { config: { authorization: householdRoute() }, schema: { body: CHECK_BODY_SCHEMA } },
    async (request, reply): Promise<ShoppingRowDto | undefined> => {
      const session = requireSession(request);
      const { rowId } = request.params as { rowId: string };
      if (!UUID.test(rowId)) return notFound(request, reply);
      const body = request.body as CheckShoppingRowRequestDto;
      try {
        const result = await deps.tenantSession.write(session, (client) =>
          checkShoppingRow(client, session.householdId, rowId, {
            idempotencyKey: body.idempotencyKey,
            checked: body.checked,
            actorUserId: session.userId,
          }),
        );
        request.log.info(
          {
            routePath: routePath(request),
            actorUserId: session.userId,
            checked: body.checked,
            changed: result.changed,
            replayed: result.replayed,
          },
          "shopping.row.checked",
        );
        return result.row;
      } catch (error) {
        return answerFailure(request, reply, error);
      }
    },
  );

  app.post(
    SHOPPING_ROW_ADD_TO_INVENTORY_ROUTE,
    { config: { authorization: householdRoute() }, schema: { body: ADD_BODY_SCHEMA } },
    async (request, reply): Promise<InventoryWriteResponseDto | undefined> => {
      const session = requireSession(request);
      const { rowId } = request.params as { rowId: string };
      if (!UUID.test(rowId)) return notFound(request, reply);
      const body = request.body as AddShoppingRowToInventoryRequestDto;
      try {
        const result = await deps.tenantSession.write(session, (client) =>
          addShoppingRowToInventory(client, session.householdId, rowId, {
            idempotencyKey: body.idempotencyKey,
            actorUserId: session.userId,
          }),
        );
        request.log.info(
          {
            routePath: routePath(request),
            actorUserId: session.userId,
            rows: result.replayed ? 0 : 1,
            replayed: result.replayed,
          },
          "shopping.row.added-to-inventory",
        );
        const answer: InventoryWriteResponseDto = {
          transactions: result.transactions,
          item: result.detail,
          replayed: result.replayed,
        };
        // Sent explicitly: a Fastify reply is thenable.
        await reply.code(result.replayed ? 200 : 201).send(answer);
        return undefined;
      } catch (error) {
        return answerFailure(request, reply, error);
      }
    },
  );

  app.post(
    SHOPPING_ROW_REMOVE_ROUTE,
    { config: { authorization: householdRoute() } },
    async (request, reply): Promise<undefined> => {
      const session = requireSession(request);
      const { rowId } = request.params as { rowId: string };
      if (!UUID.test(rowId)) return notFound(request, reply);
      if (!isEmptyBody(request.body)) {
        await reply
          .code(400)
          .send(errorBody("BAD_REQUEST", "That request could not be understood.", request.id));
        return undefined;
      }
      try {
        const result = await deps.tenantSession.write(session, (client) =>
          removeShoppingRow(client, session.householdId, rowId, session.userId),
        );
        request.log.info(
          {
            routePath: routePath(request),
            actorUserId: session.userId,
            removed: result.removed,
          },
          "shopping.row.removed",
        );
        await reply.code(204).send();
        return undefined;
      } catch (error) {
        return answerFailure(request, reply, error);
      }
    },
  );
}
