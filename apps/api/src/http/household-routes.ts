/**
 * Household endpoints (M2-T3 (a) to (d), (g)).
 *
 * | Route | Declaration | Runs in |
 * | --- | --- | --- |
 * | `POST /v1/households` | `userRoute` | the new household's own context |
 * | `POST /v1/households/join` | `userRoute`, rate limited | no household, then the joined one |
 * | `GET /v1/households/me` | `householdRoute` | the session's household |
 * | `GET /v1/households/mine` | `userRoute` | no household (definer function) |
 * | `POST /v1/households/me/join-code` | `ownerRoute` | the session's household |
 *
 * Rules that hold across all five:
 *
 * - **Identity only from the session.** The caller is `request.caller` /
 *   `request.session`, which only the identity port sets. No body field names a
 *   user or a household; the join body carries a code and nothing else, and a
 *   body with anything more is refused by the schema (`additionalProperties:
 *   false`, and `removeAdditional` is off, `app.ts`).
 * - **A join adds exactly one membership, for the caller.** The user id passed
 *   to the database is the session's, and `app_redeem_join_code` inserts one
 *   row or none (migration 0008).
 * - **One answer for every bad code.** Unknown, rotated away, malformed: 404
 *   `JOIN_CODE_INVALID`, the same body, after the same rate-limit charge. The
 *   eleventh attempt in ten minutes is 429 whatever the code.
 * - **The code is never logged.** Not the plaintext, not the hash. The request
 *   body is never logged anywhere (`logging.ts`), the redaction denylist holds
 *   `joinCode` and `code` keys regardless, and the audit lines below carry ids
 *   only.
 */

import {
  HOUSEHOLD_JOIN_CODE_PATH,
  HOUSEHOLD_JOIN_PATH,
  HOUSEHOLD_ME_PATH,
  HOUSEHOLD_MINE_PATH,
  HOUSEHOLD_NAME_MAX_LENGTH,
  HOUSEHOLDS_PATH,
  type ApiErrorBodyDto,
  type ApiErrorCode,
  type CreateHouseholdRequestDto,
  type CreateHouseholdResponseDto,
  type HouseholdMembershipsResponseDto,
  type HouseholdSummaryDto,
  type JoinHouseholdRequestDto,
  type JoinHouseholdResponseDto,
  type RotateJoinCodeResponseDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { displayInitials } from "../db/inventory/detail.js";
import { normalizeJoinCode, type JoinCodeHasher } from "../db/households/join-code.js";
import {
  createHousehold,
  listMembershipsForUser,
  readHousehold,
  redeemJoinCode,
  rotateJoinCode,
  type HouseholdRow,
  type IssuedJoinCode,
} from "../db/households/repository.js";
import { uuidv7 } from "../ids/uuidv7.js";
import {
  householdRoute,
  ownerRoute,
  requireCaller,
  requireSession,
  userRoute,
} from "./authorization.js";
import { logMembershipChange } from "./logging.js";
import type { MembershipSessionRunner } from "./membership-session.js";
import type { AttemptLimiter } from "./rate-limit.js";
import type { TenantSessionRunner } from "./tenant-session.js";

export interface HouseholdRouteDeps {
  readonly tenantSession: TenantSessionRunner;
  readonly memberships: MembershipSessionRunner;
  readonly joinCodes: JoinCodeHasher;
  readonly joinLimiter: AttemptLimiter;
  /** Id generator for new households and memberships; UUIDv7 by default. */
  readonly newId?: () => string;
}

/** The one sentence every bad code gets (mirrors the S1 client copy). */
export const JOIN_CODE_INVALID_MESSAGE =
  "That code didn't match a household. Check it with whoever invited you.";

export const RATE_LIMITED_MESSAGE = "Too many tries. Wait a few minutes and try again.";

export const HOUSEHOLD_NAME_MESSAGE = `Give the household a name of 1 to ${String(
  HOUSEHOLD_NAME_MAX_LENGTH,
)} characters.`;

const CONTROL_CHARACTERS = /\p{Cc}/u;

const CREATE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    // Generous here; the exact 1-to-60-after-trimming rule is checked below so
    // the refusal can carry its own sentence.
    name: { type: "string", maxLength: 256 },
  },
} as const;

/**
 * Rotation takes no input (review F3): no body, `null` or `{}` is accepted,
 * anything else, such as a `householdId` naming another household, is a 400
 * like every other unknown body field in this API. Checked in the handler
 * rather than by a body schema, because a Fastify body schema also rejects a
 * request that sends no body at all, which is how a client normally calls this.
 */
function isEmptyBody(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  return typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
}

const JOIN_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: {
    code: { type: "string", maxLength: 64 },
  },
} as const;

function errorBody(code: ApiErrorCode, message: string, correlationId: string): ApiErrorBodyDto {
  return { error: { code, message, correlationId } };
}

async function send(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
): Promise<undefined> {
  await reply.code(statusCode).send(errorBody(code, message, request.id));
  return undefined;
}

/** The trimmed name, or `undefined` when it is outside 1 to 60 printable characters. */
export function validHouseholdName(raw: string): string | undefined {
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > HOUSEHOLD_NAME_MAX_LENGTH) return undefined;
  if (CONTROL_CHARACTERS.test(name)) return undefined;
  return name;
}

function toSummary(row: HouseholdRow, callerUserId: string): HouseholdSummaryDto {
  return {
    householdId: row.householdId,
    name: row.name,
    members: row.members.map((member) => ({
      memberId: member.membershipId,
      displayInitials: displayInitials(member.displayName) ?? "?",
      role: member.role,
      isCaller: member.userId === callerUserId,
    })),
  };
}

function joinCodeDto(issued: IssuedJoinCode): { code: string; issuedAt: string } {
  return { code: issued.code, issuedAt: issued.issuedAt };
}

export function registerHouseholdRoutes(app: FastifyInstance, deps: HouseholdRouteDeps): void {
  const newId = deps.newId ?? uuidv7;

  app.post(
    HOUSEHOLDS_PATH,
    {
      config: {
        authorization: userRoute(
          "a person creates their first household before they belong to one, so no household " +
            "can be required; the new household's id is minted here, never taken from the request",
        ),
      },
      schema: { body: CREATE_BODY_SCHEMA },
    },
    async (request, reply): Promise<CreateHouseholdResponseDto | undefined> => {
      const caller = requireCaller(request);
      const name = validHouseholdName((request.body as CreateHouseholdRequestDto).name);
      if (name === undefined) {
        return send(reply, request, 400, "BAD_REQUEST", HOUSEHOLD_NAME_MESSAGE);
      }

      const householdId = newId();
      const membershipId = newId();
      const { issued, row } = await deps.memberships.inNewHousehold(householdId, async (client) => {
        const code = await createHousehold(
          client,
          { householdId, membershipId, name, ownerUserId: caller.userId },
          deps.joinCodes,
        );
        return { issued: code, row: await readHousehold(client, householdId) };
      });
      if (row === undefined) throw new Error("a household just created was not readable");

      logMembershipChange(request, "household-created", {
        actorUserId: caller.userId,
        householdId,
        role: "owner",
      });
      // Sent explicitly: a Fastify reply is thenable, so `await reply.code(201)`
      // on its own would wait for a response that has not been sent yet.
      const created: CreateHouseholdResponseDto = {
        household: toSummary(row, caller.userId),
        joinCode: joinCodeDto(issued),
      };
      await reply.code(201).send(created);
      return undefined;
    },
  );

  app.post(
    HOUSEHOLD_JOIN_PATH,
    {
      config: {
        authorization: userRoute(
          "a person joins a household they are not yet in, so no household can be required; " +
            "the code is the only thing that names the household",
        ),
      },
      schema: { body: JOIN_BODY_SCHEMA },
    },
    async (request, reply): Promise<JoinHouseholdResponseDto | undefined> => {
      const caller = requireCaller(request);
      // Charged before anything about the code is looked at, so a burst of
      // concurrent guesses cannot outrun the count.
      if (!deps.joinLimiter.tryAcquire(caller.userId)) {
        request.log.warn({ userId: caller.userId }, "household.join.rate-limited");
        return send(reply, request, 429, "RATE_LIMITED", RATE_LIMITED_MESSAGE);
      }

      const normalized = normalizeJoinCode((request.body as JoinHouseholdRequestDto).code);
      const redeemed =
        normalized === undefined
          ? undefined
          : await deps.memberships.outsideHousehold((client) =>
              redeemJoinCode(client, deps.joinCodes.hash(normalized), caller.userId, newId()),
            );
      if (redeemed === undefined) {
        return send(reply, request, 404, "JOIN_CODE_INVALID", JOIN_CODE_INVALID_MESSAGE);
      }

      // The household id here came back from the database's own code lookup,
      // never from the request.
      const row = await deps.tenantSession.read(
        { userId: caller.userId, householdId: redeemed.householdId, role: redeemed.role },
        (client) => readHousehold(client, redeemed.householdId),
      );
      if (row === undefined) throw new Error("a household just joined was not readable");

      if (redeemed.joined) {
        logMembershipChange(request, "joined-by-code", {
          actorUserId: caller.userId,
          householdId: redeemed.householdId,
          role: redeemed.role,
        });
      }
      return { household: toSummary(row, caller.userId), alreadyMember: !redeemed.joined };
    },
  );

  app.get(
    HOUSEHOLD_ME_PATH,
    { config: { authorization: householdRoute() } },
    async (request, reply): Promise<HouseholdSummaryDto | undefined> => {
      const session = requireSession(request);
      const row = await deps.tenantSession.read(session, (client) =>
        readHousehold(client, session.householdId),
      );
      if (row === undefined) return send(reply, request, 404, "NOT_FOUND", "Not found.");
      return toSummary(row, session.userId);
    },
  );

  app.get(
    HOUSEHOLD_MINE_PATH,
    {
      config: {
        authorization: userRoute(
          "lists the households the caller belongs to, which is empty for a person who has not " +
            "created or joined one yet and must still answer",
        ),
      },
    },
    async (request): Promise<HouseholdMembershipsResponseDto> => {
      const caller = requireCaller(request);
      const current = request.session?.householdId;
      const named = await deps.memberships.outsideHousehold((client) =>
        listMembershipsForUser(client, caller.userId),
      );
      const names = new Map(named.map((entry) => [entry.householdId, entry.householdName]));
      // The set is the port's (OQ-E1); the database only supplies names.
      const households = caller.memberships.flatMap((membership) => {
        const name = names.get(membership.householdId);
        if (name === undefined) return [];
        return [
          {
            householdId: membership.householdId,
            name,
            role: membership.role,
            joinedAt: membership.joinedAt,
            current: membership.householdId === current,
          },
        ];
      });
      return { households };
    },
  );

  app.post(
    HOUSEHOLD_JOIN_CODE_PATH,
    { config: { authorization: ownerRoute() } },
    async (request, reply): Promise<RotateJoinCodeResponseDto | undefined> => {
      const session = requireSession(request);
      if (!isEmptyBody(request.body)) {
        return send(reply, request, 400, "BAD_REQUEST", "That request could not be understood.");
      }
      // The declaration already refused a member; this is the second layer, so
      // the rule survives a future edit to the declaration.
      if (session.role !== "owner") {
        return send(reply, request, 403, "NOT_OWNER", "Only the household owner can do that.");
      }
      const issued = await deps.tenantSession.write(session, (client) =>
        rotateJoinCode(client, session.householdId, session.userId, deps.joinCodes),
      );
      logMembershipChange(request, "join-code-rotated", {
        actorUserId: session.userId,
        householdId: session.householdId,
      });
      return { joinCode: joinCodeDto(issued) };
    },
  );
}
