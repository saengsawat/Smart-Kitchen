/**
 * Fixture identity adapter (M2-T1, D-022).
 *
 * Reads `tests/fixtures/identity/sessions.json` and answers
 * {@link IdentityPort.resolveSession} by exact token match. No network, no
 * vendor, no cost. This is D-022's "build against a stubbed identity first".
 *
 * **This module must never be reachable in production.** It is registered only
 * by `selectIdentityPort` (registry.ts), which refuses the combination
 * `NODE_ENV=production` + `SK_IDENTITY=fixture`. The refusal lives there rather
 * than here so that a future adapter selection cannot bypass it by importing
 * this file directly: importing it is harmless, *choosing* it is what is
 * guarded.
 *
 * The file is validated, not trusted. A fixture map that is missing a field,
 * reuses a token, or points a session at an undeclared household is a
 * configuration bug that would show up later as a confusing authorization
 * result, so it is refused at load time with a message naming the entry.
 */

import { readFile } from "node:fs/promises";
import { IDENTITY_SESSIONS_FIXTURE_PATH } from "./fixture-paths.js";
import {
  isHouseholdRole,
  orderMemberships,
  sessionFor,
  type Caller,
  type HouseholdRole,
  type IdentityPort,
  type Membership,
  type MembershipDirectory,
  type Session,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A household declared by the fixture map. */
export interface FixtureHousehold {
  readonly householdId: string;
  readonly name: string;
}

/**
 * One fixture sign-in.
 *
 * `displayName`, `displayInitials` and `email` are here so the seeding helper
 * can write realistic `users` rows and so the redaction tests have real
 * personal-shaped strings to prove absent from the logs. They are never part of
 * a {@link Session} and never cross the port.
 */
export interface FixtureSession {
  readonly token: string;
  readonly userId: string;
  readonly householdId: string;
  readonly role: HouseholdRole;
  readonly displayName: string;
  readonly displayInitials: string;
  readonly email: string;
}

/**
 * A fixture sign-in with no household yet (M2-T3: `fixture.new.user`).
 *
 * Kept apart from {@link FixtureSession} rather than making that type's
 * `householdId` optional, so every existing reader of a fixture session keeps
 * a household it can rely on, and a household-less person is a distinct,
 * visible case.
 */
export interface FixtureUser {
  readonly token: string;
  readonly userId: string;
  readonly displayName: string;
  readonly displayInitials: string;
  readonly email: string;
}

/** The whole validated fixture map. */
export interface FixtureIdentityData {
  readonly households: readonly FixtureHousehold[];
  readonly sessions: readonly FixtureSession[];
  /** Sign-ins declared with no `householdId` and no `role`. */
  readonly unaffiliated: readonly FixtureUser[];
}

/** Raised when the fixture file cannot be understood. */
export class FixtureIdentityError extends Error {
  constructor(message: string) {
    super(`${message} (fixture map: ${IDENTITY_SESSIONS_FIXTURE_PATH})`);
    this.name = "FixtureIdentityError";
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FixtureIdentityError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new FixtureIdentityError(`${what}.${key} must be a non-empty string`);
  }
  return value;
}

function requireUuid(source: Record<string, unknown>, key: string, what: string): string {
  const value = requireString(source, key, what);
  if (!UUID.test(value)) {
    throw new FixtureIdentityError(`${what}.${key} must be a UUID, got "${value}"`);
  }
  return value;
}

function requireArray(source: Record<string, unknown>, key: string): readonly unknown[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new FixtureIdentityError(`"${key}" must be a non-empty array`);
  }
  return value;
}

/** Validates an already-parsed fixture map (exported so tests can feed it bad shapes directly). */
export function parseFixtureIdentityData(raw: unknown): FixtureIdentityData {
  const root = asRecord(raw, "the fixture map");

  const households: FixtureHousehold[] = [];
  const householdIds = new Set<string>();
  for (const [index, entry] of requireArray(root, "households").entries()) {
    const what = `households[${String(index)}]`;
    const record = asRecord(entry, what);
    const householdId = requireUuid(record, "householdId", what);
    if (householdIds.has(householdId)) {
      throw new FixtureIdentityError(`${what}.householdId "${householdId}" is declared twice`);
    }
    householdIds.add(householdId);
    households.push({ householdId, name: requireString(record, "name", what) });
  }

  const sessions: FixtureSession[] = [];
  const unaffiliated: FixtureUser[] = [];
  const tokens = new Set<string>();
  const userIds = new Set<string>();
  for (const [index, entry] of requireArray(root, "sessions").entries()) {
    const what = `sessions[${String(index)}]`;
    const record = asRecord(entry, what);
    const token = requireString(record, "token", what);
    if (tokens.has(token)) {
      throw new FixtureIdentityError(`${what}.token "${token}" is declared twice`);
    }
    tokens.add(token);

    const userId = requireUuid(record, "userId", what);
    if (userIds.has(userId)) {
      throw new FixtureIdentityError(`${what}.userId "${userId}" is declared twice`);
    }
    userIds.add(userId);

    // A sign-in with no household states neither field; stating one without
    // the other is a half-written entry, not a household-less person.
    if (record["householdId"] === undefined && record["role"] === undefined) {
      unaffiliated.push({
        token,
        userId,
        displayName: requireString(record, "displayName", what),
        displayInitials: requireString(record, "displayInitials", what),
        email: requireString(record, "email", what),
      });
      continue;
    }

    const householdId = requireUuid(record, "householdId", what);
    if (!householdIds.has(householdId)) {
      throw new FixtureIdentityError(
        `${what}.householdId "${householdId}" is not a declared household`,
      );
    }

    const role = record["role"];
    if (!isHouseholdRole(role)) {
      throw new FixtureIdentityError(`${what}.role must be "owner" or "member"`);
    }

    sessions.push({
      token,
      userId,
      householdId,
      role,
      displayName: requireString(record, "displayName", what),
      displayInitials: requireString(record, "displayInitials", what),
      email: requireString(record, "email", what),
    });
  }

  return { households, sessions, unaffiliated };
}

/** Reads and validates `tests/fixtures/identity/sessions.json`. */
export async function loadFixtureIdentityData(
  filePath: string = IDENTITY_SESSIONS_FIXTURE_PATH,
): Promise<FixtureIdentityData> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (cause) {
    throw new FixtureIdentityError(
      `could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new FixtureIdentityError(
      `is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return parseFixtureIdentityData(parsed);
}

/** Options for {@link createFixtureIdentityPort}. */
export interface FixtureIdentityPortOptions {
  /**
   * Where memberships come from once households can be created and joined
   * (M2-T3). When given, the database is the only source of memberships and
   * the fixture map's `householdId`/`role` are seed input, nothing more: a
   * household a fixture user creates, or one they join, takes effect on the
   * next request. When omitted, the map's own declaration is the membership,
   * which is what every suite without a database uses.
   */
  readonly memberships?: MembershipDirectory;
}

/**
 * The time recorded for a membership the fixture map declares, for the
 * directory-less port. The map records no time; with at most one membership
 * per entry the value never decides anything.
 */
const DECLARED_JOINED_AT = new Date(0).toISOString();

/**
 * Builds the port over an already-loaded map.
 *
 * Lookup is an exact match on the whole token. There is no prefix match, no
 * case folding and no trimming: a token is a token, and "nearly right" is
 * wrong. Unknown tokens return `null`, which the HTTP layer turns into 401.
 */
export function createFixtureIdentityPort(
  data: FixtureIdentityData,
  options: FixtureIdentityPortOptions = {},
): IdentityPort {
  const userByToken = new Map<string, string>();
  const declared = new Map<string, readonly Membership[]>();
  for (const session of data.sessions) {
    userByToken.set(session.token, session.userId);
    declared.set(session.userId, [
      { householdId: session.householdId, role: session.role, joinedAt: DECLARED_JOINED_AT },
    ]);
  }
  for (const user of data.unaffiliated) {
    userByToken.set(user.token, user.userId);
    declared.set(user.userId, []);
  }
  const directory = options.memberships;

  async function resolveCaller(bearerToken: string): Promise<Caller | null> {
    const userId = userByToken.get(bearerToken);
    if (userId === undefined) return null;
    const memberships =
      directory === undefined
        ? (declared.get(userId) ?? [])
        : await directory.listMemberships(userId);
    return { userId, memberships: orderMemberships(memberships) };
  }

  return {
    resolveCaller,
    async resolveSession(bearerToken: string): Promise<Session | null> {
      return sessionFor(await resolveCaller(bearerToken));
    },
  };
}
