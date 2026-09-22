/**
 * Identity adapter selection (M2-T1, ADR-004, D-022).
 *
 * One function decides which {@link IdentityPort} the process runs with, and it
 * is written to fail rather than guess:
 *
 * - `SK_IDENTITY` must name an adapter. Unset or unknown is a refusal, not a
 *   fallback to the fixture and certainly not to "no authentication".
 * - `SK_IDENTITY=fixture` is refused outside an allowlist of environments
 *   (unset, `development`, `test`). The fixture tokens are public strings in
 *   the repo; a production process that accepted them would be an
 *   authentication bypass, so the process must not start at all
 *   (ARCHITECTURE.md §7.1, §7.2). An allowlist rather than a check against the
 *   literal `production`, so that `Production`, `prod` and a stray trailing
 *   space fail closed instead of loading the fixtures.
 * - `fixture` is currently the only adapter. No vendor has been chosen
 *   (ADR-004 is PROPOSED on vendor, D-022), so a non-fixture value is refused
 *   with a message that says exactly that rather than inventing one.
 *
 * The refusal is an exception here and an exit code in `server.ts`. Keeping the
 * decision pure makes it testable without spawning a process, and keeps the
 * "how do we tell the operator" concern in the one module that owns the
 * process.
 */

import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  type FixtureIdentityData,
} from "./fixture-identity-port.js";
import type { IdentityPort } from "./types.js";

/** Environment variable naming the adapter to register. */
export const IDENTITY_ENV_VAR = "SK_IDENTITY";

/** The only adapter that exists today (D-022). */
export const FIXTURE_IDENTITY_ADAPTER = "fixture";

/**
 * Refusal to configure identity. Always fatal: there is no degraded mode in
 * which the API serves household data without knowing who is asking.
 */
export class IdentityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConfigurationError";
  }
}

/** Minimal view of the environment, so tests never mutate `process.env`. */
export type EnvironmentLike = Readonly<Record<string, string | undefined>>;

/**
 * The only environments the fixture adapter may load in.
 *
 * An **allowlist**, not a `!== "production"` check (M2-T1 review finding F3).
 * A denylist on the literal string `production` lets `Production`, `PRODUCTION`,
 * `prod`, `"production "` and every other spelling of the same intent through,
 * and each of those would load the repository's public tokens into a real
 * deployment. Anything this list does not recognise is refused, so a typo in a
 * deployment variable fails closed and loudly rather than opening the door.
 */
export const FIXTURE_PERMITTED_NODE_ENVS: readonly string[] = Object.freeze([
  "development",
  "test",
]);

/** `NODE_ENV` trimmed and lowercased, or `undefined` when unset or blank. */
export function normalizeNodeEnv(env: EnvironmentLike): string | undefined {
  const raw = env["NODE_ENV"];
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  return normalized === "" ? undefined : normalized;
}

/**
 * True when this environment is one the fixture adapter may load in: an unset
 * `NODE_ENV` (a bare local run) or one of {@link FIXTURE_PERMITTED_NODE_ENVS}.
 */
export function isFixtureEnvironmentPermitted(env: EnvironmentLike): boolean {
  const nodeEnv = normalizeNodeEnv(env);
  return nodeEnv === undefined || FIXTURE_PERMITTED_NODE_ENVS.includes(nodeEnv);
}

/**
 * Decides which adapter to register, without loading anything.
 *
 * Split out from {@link selectIdentityPort} so the production refusal can be
 * asserted on its own, with no filesystem involved.
 */
export function chooseIdentityAdapter(env: EnvironmentLike): typeof FIXTURE_IDENTITY_ADAPTER {
  const requested = env[IDENTITY_ENV_VAR];

  if (requested === undefined || requested.trim() === "") {
    throw new IdentityConfigurationError(
      `${IDENTITY_ENV_VAR} is not set, so no identity adapter can be registered and every request ` +
        `would be denied. Set ${IDENTITY_ENV_VAR}=${FIXTURE_IDENTITY_ADAPTER} for development ` +
        `(see tests/fixtures/identity/README.md). There is no production adapter yet: ADR-004's ` +
        `vendor decision is still open (D-022).`,
    );
  }

  if (requested !== FIXTURE_IDENTITY_ADAPTER) {
    throw new IdentityConfigurationError(
      `${IDENTITY_ENV_VAR}="${requested}" names no known identity adapter. The only adapter that ` +
        `exists is "${FIXTURE_IDENTITY_ADAPTER}" (D-022); the real provider arrives with ADR-004's ` +
        `vendor decision.`,
    );
  }

  if (!isFixtureEnvironmentPermitted(env)) {
    throw new IdentityConfigurationError(
      `refusing to start: ${IDENTITY_ENV_VAR}=${FIXTURE_IDENTITY_ADAPTER} with ` +
        `NODE_ENV=${env["NODE_ENV"] ?? ""}. The fixture identities are public, non-secret strings ` +
        `committed to this repository (tests/fixtures/identity/README.md), so accepting them ` +
        `outside development would be an authentication bypass. The fixture adapter loads only ` +
        `with NODE_ENV unset or one of: ${FIXTURE_PERMITTED_NODE_ENVS.join(", ")}. Unset ` +
        `${IDENTITY_ENV_VAR} and deploy a real identity adapter, or do not run this build with ` +
        `NODE_ENV=${env["NODE_ENV"] ?? ""}.`,
    );
  }

  return FIXTURE_IDENTITY_ADAPTER;
}

export interface SelectIdentityPortOptions {
  /** Pre-loaded fixture map, so tests can avoid the filesystem. */
  readonly fixtureData?: FixtureIdentityData;
}

/** Chooses and constructs the identity adapter for this process. */
export async function selectIdentityPort(
  env: EnvironmentLike,
  options: SelectIdentityPortOptions = {},
): Promise<IdentityPort> {
  chooseIdentityAdapter(env);
  const data = options.fixtureData ?? (await loadFixtureIdentityData());
  return createFixtureIdentityPort(data);
}
