/**
 * Household join codes (M2-T3 (f)): format, generation and hashing.
 *
 * A code looks like `CHEN-482`: four letters, a hyphen, three digits, drawn
 * from alphabets with the look-alikes removed (no `I` or `O`, no `0` or `1`),
 * because a code is read aloud across a kitchen or copied off a screen. That
 * gives 24^4 x 8^3 = 169,869,312 codes. The space is small enough that the
 * online guard matters (the per-user rate limit in `http/rate-limit.ts`) and
 * the offline one matters too, which is why the stored form is not a plain
 * hash.
 *
 * **Stored form.** HMAC-SHA-256 of the normalised code under a server-side
 * pepper, as lowercase hex. A plain SHA-256 of a 28-bit space is reversed by
 * enumeration in seconds, so a leaked `household_join_codes` table would be a
 * leaked set of live codes. With a pepper that lives only in the process
 * environment, the table alone gives an attacker nothing to enumerate
 * against. The plaintext is returned to the caller once, at issue, and is
 * never stored and never logged.
 *
 * **Pepper.** `SK_JOIN_CODE_PEPPER`, at least 32 characters. Where the fixture
 * identities may load (`NODE_ENV` unset, `development`, `test`), an unset
 * pepper falls back to {@link DEVELOPMENT_JOIN_CODE_PEPPER}, a public constant
 * in this file that protects nothing, exactly like the fixture tokens it sits
 * beside. Anywhere else an unset or short pepper refuses to start. The value
 * must be the same for the API and the seed, or the seeded `CHEN-482` will not
 * match; both resolve it through {@link resolveJoinCodePepper}.
 *
 * This is ordinary use of Node's built-in `crypto` HMAC, not custom
 * cryptography (ARCHITECTURE.md §7.5).
 */

import { createHmac, randomInt } from "node:crypto";
import {
  FIXTURE_PERMITTED_NODE_ENVS,
  isFixtureEnvironmentPermitted,
  type EnvironmentLike,
} from "../../identity/index.js";

/** Letters a code may use: A to Z without I and O. */
export const JOIN_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Digits a code may use: 2 to 9 (no 0 or 1). */
export const JOIN_CODE_DIGITS = "23456789";

/** The canonical shape, after normalisation. */
export const JOIN_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[2-9]{3}$/;

/** Environment variable carrying the pepper. Its value is a secret outside development. */
export const JOIN_CODE_PEPPER_ENV_VAR = "SK_JOIN_CODE_PEPPER";

/** Shortest pepper accepted from the environment. */
export const MIN_JOIN_CODE_PEPPER_LENGTH = 32;

/**
 * The development pepper. **Not a secret**: it is committed here on purpose,
 * it is used only where the committed fixture tokens are also accepted, and a
 * process that is not in a fixture environment refuses to fall back to it.
 */
export const DEVELOPMENT_JOIN_CODE_PEPPER =
  "smart-kitchen development join-code pepper, public and not a secret";

/** The code the dev seed issues to the Chen household (the mobile fixture's code). */
export const CHEN_FIXTURE_JOIN_CODE = "CHEN-482";

export class JoinCodeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JoinCodeConfigurationError";
  }
}

/**
 * The pepper this process hashes codes under, or a refusal.
 *
 * The message names the variable and never its value.
 */
export function resolveJoinCodePepper(env: EnvironmentLike): string {
  const configured = env[JOIN_CODE_PEPPER_ENV_VAR];
  if (configured !== undefined && configured !== "") {
    if (configured.length < MIN_JOIN_CODE_PEPPER_LENGTH) {
      throw new JoinCodeConfigurationError(
        `${JOIN_CODE_PEPPER_ENV_VAR} is set but shorter than ` +
          `${String(MIN_JOIN_CODE_PEPPER_LENGTH)} characters, so join codes would be hashed ` +
          `under a guessable key. Set a longer random value.`,
      );
    }
    return configured;
  }
  if (isFixtureEnvironmentPermitted(env)) return DEVELOPMENT_JOIN_CODE_PEPPER;
  throw new JoinCodeConfigurationError(
    `${JOIN_CODE_PEPPER_ENV_VAR} is not set. Outside NODE_ENV ` +
      `${FIXTURE_PERMITTED_NODE_ENVS.join("/")} (or unset) the API will not fall back to the ` +
      `public development pepper, because codes hashed under it could be enumerated from a copy ` +
      `of the table. Set ${JOIN_CODE_PEPPER_ENV_VAR} from the platform's secret store.`,
  );
}

/**
 * Normalises what a person typed: surrounding whitespace removed, letters
 * upper-cased. Returns `undefined` for anything that is not a well-formed
 * code afterwards, which the caller answers exactly like a wrong code.
 */
export function normalizeJoinCode(input: string): string | undefined {
  const normalized = input.trim().toUpperCase();
  return JOIN_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

/** Turns plaintext codes into their stored form. */
export interface JoinCodeHasher {
  /** Lowercase hex HMAC-SHA-256 of an already-normalised code. */
  hash(normalizedCode: string): string;
}

export function createJoinCodeHasher(pepper: string): JoinCodeHasher {
  if (pepper.length === 0) throw new JoinCodeConfigurationError("the join-code pepper is empty");
  return {
    hash(normalizedCode: string): string {
      return createHmac("sha256", pepper).update(normalizedCode, "utf8").digest("hex");
    },
  };
}

/** Source of randomness for code generation, injectable for tests. */
export type RandomIndex = (exclusiveMax: number) => number;

/**
 * A fresh code, uniformly drawn with the platform CSPRNG (`crypto.randomInt`,
 * which rejects modulo bias itself).
 */
export function generateJoinCode(random: RandomIndex = randomInt): string {
  let letters = "";
  for (let index = 0; index < 4; index += 1) {
    letters += JOIN_CODE_LETTERS.charAt(random(JOIN_CODE_LETTERS.length));
  }
  let digits = "";
  for (let index = 0; index < 3; index += 1) {
    digits += JOIN_CODE_DIGITS.charAt(random(JOIN_CODE_DIGITS.length));
  }
  return `${letters}-${digits}`;
}
