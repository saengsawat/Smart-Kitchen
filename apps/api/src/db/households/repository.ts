/**
 * Household persistence (M2-T3): create, join by code, rotate the code, read
 * a household with its members, list one user's memberships.
 *
 * Every function takes a client already inside the right transaction. Which
 * transaction that is matters, and it is the caller's job
 * (`http/membership-session.ts`):
 *
 * - **create** runs inside the brand-new household's own context (the id is
 *   minted by the server, never taken from the request), so the join-code
 *   insert that follows passes the row-level security check like any other
 *   household-scoped write;
 * - **redeem** and **list memberships** run with *no* household context. The
 *   caller is by definition not in the household yet, so the only things
 *   reachable are migration 0008's SECURITY DEFINER doors, each of which
 *   creates or reveals exactly one user's memberships;
 * - **rotate** and **read** run inside the caller's current household, like
 *   every other household-scoped statement.
 *
 * Nothing here logs, and nothing here ever sees a plaintext code except
 * {@link issueJoinCode}, which returns it once to its caller and keeps only
 * the hash.
 */

import type { ClientBase } from "pg";
import { isHouseholdRole, type HouseholdRole, type Membership } from "../../identity/index.js";
import { generateJoinCode, type JoinCodeHasher, type RandomIndex } from "./join-code.js";

/** How many fresh codes to draw before giving up on a hash collision. */
const MAX_CODE_ATTEMPTS = 8;

/** A code as issued: the plaintext, returned once, and when it was issued. */
export interface IssuedJoinCode {
  readonly code: string;
  readonly issuedAt: string;
}

/** One member as the household endpoints need it. */
export interface HouseholdMemberRow {
  readonly membershipId: string;
  readonly userId: string;
  readonly role: HouseholdRole;
  readonly displayName: string | null;
  readonly joinedAt: string;
}

export interface HouseholdRow {
  readonly householdId: string;
  readonly name: string;
  readonly members: readonly HouseholdMemberRow[];
}

/** A membership plus the household's name, for `GET /v1/households/mine`. */
export interface NamedMembership extends Membership {
  readonly householdName: string;
}

/** Raised when a stored value is not something this code could have written. */
export class HouseholdIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HouseholdIntegrityError";
  }
}

/** Raised when no unused code could be drawn. Astronomically unlikely; never retried silently forever. */
export class JoinCodeExhaustedError extends Error {
  constructor() {
    super(`could not draw an unused join code in ${String(MAX_CODE_ATTEMPTS)} attempts`);
    this.name = "JoinCodeExhaustedError";
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toRole(value: string): HouseholdRole {
  if (!isHouseholdRole(value)) {
    throw new HouseholdIntegrityError("a stored membership has a role outside owner/member");
  }
  return value;
}

/**
 * Stores the hash of a fresh code for `householdId` and returns the plaintext.
 *
 * `ON CONFLICT (code_hash) DO NOTHING` plus a redraw handles the one collision
 * that can happen: a new code equal to one already issued somewhere (live or
 * revoked, any household). The caller learns nothing about the other row; it
 * simply gets a different code.
 */
export async function issueJoinCode(
  client: ClientBase,
  householdId: string,
  createdBy: string,
  hasher: JoinCodeHasher,
  random?: RandomIndex,
): Promise<IssuedJoinCode> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = random === undefined ? generateJoinCode() : generateJoinCode(random);
    const inserted = await client.query<{ created_at: Date }>(
      `INSERT INTO household_join_codes (code_hash, household_id, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (code_hash) DO NOTHING
       RETURNING created_at`,
      [hasher.hash(code), householdId, createdBy],
    );
    const row = inserted.rows[0];
    if (row !== undefined) return { code, issuedAt: toIso(row.created_at) };
  }
  throw new JoinCodeExhaustedError();
}

export interface CreateHouseholdInput {
  /** Minted by the server. The transaction's household context must already be this id. */
  readonly householdId: string;
  readonly membershipId: string;
  readonly name: string;
  readonly ownerUserId: string;
}

/** Creates the household, its owner membership and its first code, in the caller's transaction. */
export async function createHousehold(
  client: ClientBase,
  input: CreateHouseholdInput,
  hasher: JoinCodeHasher,
  random?: RandomIndex,
): Promise<IssuedJoinCode> {
  await client.query("SELECT app_create_household($1, $2, $3, $4)", [
    input.householdId,
    input.name,
    input.ownerUserId,
    input.membershipId,
  ]);
  return issueJoinCode(client, input.householdId, input.ownerUserId, hasher, random);
}

/** The outcome of a code that matched. An unknown or revoked code is `undefined`. */
export interface RedeemedJoinCode {
  readonly householdId: string;
  /** False when the user already belonged, so nothing was inserted. */
  readonly joined: boolean;
  /** The caller's role in that household now (`owner` if an owner re-joined with their own code). */
  readonly role: HouseholdRole;
}

/** Joins `userId` to the household a live code belongs to, at most once. */
export async function redeemJoinCode(
  client: ClientBase,
  codeHash: string,
  userId: string,
  membershipId: string,
): Promise<RedeemedJoinCode | undefined> {
  const result = await client.query<{ household_id: string; joined: boolean; member_role: string }>(
    "SELECT household_id, joined, member_role FROM app_redeem_join_code($1, $2, $3)",
    [codeHash, userId, membershipId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { householdId: row.household_id, joined: row.joined, role: toRole(row.member_role) };
}

/**
 * Revokes the household's live code and issues a new one.
 *
 * A transaction-scoped advisory lock on the household serialises two
 * concurrent rotations. Without it both would revoke the same old row, and the
 * second insert would collide with the first's new code on the one-live-code
 * index and surface as a 500.
 */
export async function rotateJoinCode(
  client: ClientBase,
  householdId: string,
  actorUserId: string,
  hasher: JoinCodeHasher,
  random?: RandomIndex,
): Promise<IssuedJoinCode> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `household-join-code:${householdId}`,
  ]);
  await client.query(
    `UPDATE household_join_codes SET revoked_at = now()
      WHERE household_id = $1 AND revoked_at IS NULL`,
    [householdId],
  );
  return issueJoinCode(client, householdId, actorUserId, hasher, random);
}

/** The household and its members, or `undefined` when this session cannot see it. */
export async function readHousehold(
  client: ClientBase,
  householdId: string,
): Promise<HouseholdRow | undefined> {
  const household = await client.query<{ id: string; name: string }>(
    "SELECT id, name FROM households WHERE id = $1",
    [householdId],
  );
  const row = household.rows[0];
  if (row === undefined) return undefined;

  const members = await client.query<{
    id: string;
    user_id: string;
    role: string;
    created_at: Date;
    display_name: string | null;
  }>(
    `SELECT m.id, m.user_id, m.role, m.created_at, u.display_name
       FROM household_memberships AS m
       LEFT JOIN users AS u ON u.id = m.user_id
      WHERE m.household_id = $1
      ORDER BY (m.role = 'owner') DESC, m.created_at, m.id`,
    [householdId],
  );

  return {
    householdId: row.id,
    name: row.name,
    members: members.rows.map((member) => ({
      membershipId: member.id,
      userId: member.user_id,
      role: toRole(member.role),
      displayName: member.display_name,
      joinedAt: toIso(member.created_at),
    })),
  };
}

/** Every household `userId` belongs to, most recently joined first. */
export async function listMembershipsForUser(
  client: ClientBase,
  userId: string,
): Promise<readonly NamedMembership[]> {
  const result = await client.query<{
    household_id: string;
    role: string;
    joined_at: Date;
    household_name: string;
  }>("SELECT household_id, role, joined_at, household_name FROM app_user_memberships($1)", [
    userId,
  ]);
  return result.rows.map((row) => ({
    householdId: row.household_id,
    role: toRole(row.role),
    joinedAt: toIso(row.joined_at),
    householdName: row.household_name,
  }));
}
