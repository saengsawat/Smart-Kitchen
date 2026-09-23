/**
 * Route registrations (M2-T1, extended by M2-T2).
 *
 * Every route here declares its authorization in the same object that declares
 * its method and path, which is the point: the declaration is impossible to
 * miss when reading the route and impossible to omit when writing it (the
 * `onRoute` guard in `authorization.ts` refuses the registration).
 *
 * Handlers never see the pool. They are handed the caller's session and a
 * {@link TenantSessionRunner}, so the only SQL they can issue is SQL inside a
 * transaction already scoped to that caller's household, and a write goes
 * through the runner's retried entry point.
 *
 * What a handler does and does not do, in this file:
 *
 * - it reads the caller from the session and **never** from the request. There
 *   is no request field anywhere below that names a household, a user or a lot
 *   (INV-TENANT-1, and the contracts' rules 4 and 5);
 * - it validates the request's *shape* with a JSON schema, and leaves every
 *   judgement about quantities, signs, timestamps and idempotency to the
 *   domain, so the client sees one vocabulary of refusals;
 * - it answers **404** for an item this session cannot see, whether it belongs
 *   to another household or does not exist, because telling those apart is
 *   itself information about another household;
 * - it maps a refusal to a status and a code, never to the domain's message
 *   (`ledger-errors.ts`).
 */

import {
  INVENTORY_ITEM_ROUTE,
  INVENTORY_ITEM_TRANSACTIONS_ROUTE,
  INVENTORY_ITEMS_PATH,
  INVENTORY_TRANSACTION_UNDO_ROUTE,
  INVENTORY_WRITE_TYPES_DTO,
  type InventoryItemDetailDto,
  type InventoryItemsResponseDto,
  type InventoryWriteRequestDto,
  type InventoryWriteResponseDto,
  type UndoRequestDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readInventoryItemDetail } from "../db/inventory/detail.js";
import { readInventorySnapshot } from "../db/inventory/snapshot.js";
import {
  applyInventoryWrite,
  undoInventoryTransaction,
  InventoryItemNotVisibleError,
  LedgerWriteRejectedError,
  UndoNotPossibleError,
  type InventoryWriteResult,
} from "../db/inventory/write-service.js";
import { householdRoute, publicRoute, requireSession } from "./authorization.js";
import {
  ledgerErrorResponse,
  notVisibleResponse,
  undoNotPossibleResponse,
} from "./ledger-errors.js";
import type { TenantSessionRunner } from "./tenant-session.js";

export interface RouteDeps {
  readonly tenantSession: TenantSessionRunner;
}

/** Path parameters are `uuid` columns; anything else names no row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Write body, by shape only.
 *
 * `additionalProperties: false` **rejects** an unknown property with a 400; it
 * does not strip it. That takes `removeAdditional: false` on the Fastify
 * instance (`app.ts`), because AJV's default under Fastify is to delete the
 * unknown property and carry on, which made `{"type":"DISCARD","amuont":"0.25"}`
 * remove an entire item and answer 200 (M2-T2 review F1). Both directions of
 * the rule matter: a client typo in an optional quantity field is now a loud
 * refusal rather than a different and larger write, and a body that tries to
 * name a household, a user or a lot is refused outright rather than merely
 * unread.
 *
 * What the schema does **not** constrain is as deliberate. `occurredAt` is
 * any string and the amounts are any strings, because the domain already
 * decides what a timestamp and a quantity are, and its verdicts
 * (`INVALID_TIMESTAMP`, `TIMESTAMP_ORDER`, `PRECISION_EXCEEDED`,
 * `QUANTITY_OUT_OF_RANGE`) are codes copy-deck.md §8 has strings for. A schema
 * pattern would turn them into a generic "malformed request" and the screen
 * would lose the sentence it is supposed to show.
 */
const WRITE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idempotencyKey", "type", "occurredAt"],
  properties: {
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
    type: { type: "string", enum: [...INVENTORY_WRITE_TYPES_DTO] },
    occurredAt: { type: "string", minLength: 1, maxLength: 64 },
    targetAmount: { type: "string", minLength: 1, maxLength: 64 },
    deltaAmount: { type: "string", minLength: 1, maxLength: 64 },
    amount: { type: "string", minLength: 1, maxLength: 64 },
    reason: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

const UNDO_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idempotencyKey", "occurredAt"],
  properties: {
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
    occurredAt: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

/** The 404 both "no such item" and "not your item" answer with. */
async function notFound(request: FastifyRequest, reply: FastifyReply): Promise<undefined> {
  await reply.code(404).send(notVisibleResponse(request.id));
  return undefined;
}

/**
 * Turns a write failure into its answer.
 *
 * Anything that is not a recognised outcome is rethrown for the app-level error
 * handler: an unknown failure is a 500 with a generic body, never a guess at
 * what the caller did wrong.
 */
async function answerFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): Promise<undefined> {
  if (error instanceof InventoryItemNotVisibleError) return notFound(request, reply);
  if (error instanceof UndoNotPossibleError) {
    request.log.info(
      { routePath: request.routeOptions.url ?? "(no route)" },
      "inventory.undo.not-possible",
    );
    await reply.code(409).send(undoNotPossibleResponse(request.id));
    return undefined;
  }
  if (error instanceof LedgerWriteRejectedError) {
    const answer = ledgerErrorResponse(error.ledgerError, request.id);
    // The code and the field, never the message: the message is a log line,
    // and `field` is the name of a request field, not caller-supplied text.
    request.log.info(
      {
        routePath: request.routeOptions.url ?? "(no route)",
        ledgerCode: error.ledgerError.code,
        field: error.ledgerError.field ?? null,
      },
      "inventory.write.refused",
    );
    await reply.code(answer.statusCode).send(answer.body);
    return undefined;
  }
  throw error;
}

/** One line per applied write: what happened, never what was written. */
function logApplied(request: FastifyRequest, result: InventoryWriteResult): void {
  request.log.info(
    {
      routePath: request.routeOptions.url ?? "(no route)",
      rows: result.transactions.length,
      replayed: result.replayed,
    },
    "inventory.write.applied",
  );
}

function writeBody(result: InventoryWriteResult): InventoryWriteResponseDto {
  return { transactions: result.transactions, item: result.detail, replayed: result.replayed };
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    "/healthz",
    {
      config: {
        authorization: publicRoute(
          "liveness probe: answers with a fixed literal and reads nothing, so there is no " +
            "household state for a session to scope",
        ),
      },
    },
    () => ({ status: "ok" }),
  );

  app.get(
    INVENTORY_ITEMS_PATH,
    { config: { authorization: householdRoute() } },
    async (request): Promise<InventoryItemsResponseDto> => {
      const session = requireSession(request);
      const items = await deps.tenantSession.read(session, (client) =>
        readInventorySnapshot(client, session.householdId),
      );
      return { items };
    },
  );

  app.get(
    INVENTORY_ITEM_ROUTE,
    { config: { authorization: householdRoute() } },
    async (request, reply): Promise<InventoryItemDetailDto | undefined> => {
      const session = requireSession(request);
      const { itemId } = request.params as { itemId: string };
      if (!UUID.test(itemId)) return notFound(request, reply);

      const read = await deps.tenantSession.read(session, (client) =>
        readInventoryItemDetail(client, session.householdId, itemId),
      );
      if (read === undefined) return notFound(request, reply);
      return read.detail;
    },
  );

  app.post(
    INVENTORY_ITEM_TRANSACTIONS_ROUTE,
    { config: { authorization: householdRoute() }, schema: { body: WRITE_BODY_SCHEMA } },
    async (request, reply): Promise<InventoryWriteResponseDto | undefined> => {
      const session = requireSession(request);
      const { itemId } = request.params as { itemId: string };
      if (!UUID.test(itemId)) return notFound(request, reply);
      const body = request.body as InventoryWriteRequestDto;

      try {
        const result = await deps.tenantSession.write(session, (client) =>
          applyInventoryWrite(client, session.householdId, itemId, {
            idempotencyKey: body.idempotencyKey,
            type: body.type,
            occurredAt: body.occurredAt,
            // The server's clock, not the caller's. `recordedAt` is when we
            // recorded it, and it is excluded from the ledger's replay
            // comparison precisely so a retry can legitimately arrive later.
            recordedAt: new Date().toISOString(),
            // The actor is the session, always. There is no request field for it.
            actorUserId: session.userId,
            ...(body.targetAmount === undefined ? {} : { targetAmount: body.targetAmount }),
            ...(body.deltaAmount === undefined ? {} : { deltaAmount: body.deltaAmount }),
            ...(body.amount === undefined ? {} : { amount: body.amount }),
            ...(body.reason === undefined ? {} : { reason: body.reason }),
          }),
        );
        logApplied(request, result);
        return writeBody(result);
      } catch (error) {
        return answerFailure(request, reply, error);
      }
    },
  );

  app.post(
    INVENTORY_TRANSACTION_UNDO_ROUTE,
    { config: { authorization: householdRoute() }, schema: { body: UNDO_BODY_SCHEMA } },
    async (request, reply): Promise<InventoryWriteResponseDto | undefined> => {
      const session = requireSession(request);
      const { itemId, transactionId } = request.params as {
        itemId: string;
        transactionId: string;
      };
      if (!UUID.test(itemId) || !UUID.test(transactionId)) return notFound(request, reply);
      const body = request.body as UndoRequestDto;

      try {
        const result = await deps.tenantSession.write(session, (client) =>
          undoInventoryTransaction(client, session.householdId, itemId, {
            transactionId,
            idempotencyKey: body.idempotencyKey,
            occurredAt: body.occurredAt,
            recordedAt: new Date().toISOString(),
            actorUserId: session.userId,
          }),
        );
        logApplied(request, result);
        return writeBody(result);
      } catch (error) {
        return answerFailure(request, reply, error);
      }
    },
  );
}
