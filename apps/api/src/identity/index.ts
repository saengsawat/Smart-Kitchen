/** Identity port and its fixture adapter (M2-T1, ADR-004, D-022; memberships M2-T3). */

export {
  createFixtureIdentityPort,
  FixtureIdentityError,
  loadFixtureIdentityData,
  parseFixtureIdentityData,
  type FixtureHousehold,
  type FixtureIdentityData,
  type FixtureIdentityPortOptions,
  type FixtureSession,
  type FixtureUser,
} from "./fixture-identity-port.js";
export {
  IDENTITY_FIXTURES_DIR,
  IDENTITY_SESSIONS_FIXTURE_PATH,
  REPO_ROOT,
} from "./fixture-paths.js";
export {
  chooseIdentityAdapter,
  FIXTURE_IDENTITY_ADAPTER,
  FIXTURE_PERMITTED_NODE_ENVS,
  IDENTITY_ENV_VAR,
  IdentityConfigurationError,
  isFixtureEnvironmentPermitted,
  normalizeNodeEnv,
  selectIdentityPort,
  type EnvironmentLike,
  type SelectIdentityPortOptions,
} from "./registry.js";
export {
  HOUSEHOLD_ROLES,
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
