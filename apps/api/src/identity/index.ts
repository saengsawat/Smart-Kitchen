/** Identity port and its fixture adapter (M2-T1, ADR-004, D-022). */

export {
  createFixtureIdentityPort,
  FixtureIdentityError,
  loadFixtureIdentityData,
  parseFixtureIdentityData,
  type FixtureHousehold,
  type FixtureIdentityData,
  type FixtureSession,
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
  type HouseholdRole,
  type IdentityPort,
  type Session,
} from "./types.js";
