/**
 * The one file in `apps/mobile` allowed to read `process.env` (M3-T3;
 * `eslint.config.js`'s `no-restricted-globals`/`no-restricted-properties`
 * block for this app carries a single-file `ignores` entry naming exactly
 * this path, and nothing else in that block changed).
 *
 * Expo inlines any `EXPO_PUBLIC_*` variable into `process.env` at build time
 * (its own convention, not something this file configures); reading it needs
 * the Node-shaped `process` global that every other file in this app is
 * blocked from touching (M3-T1 invariant,
 * `src/lint-rules/node-global-containment.test.ts`). Everything downstream of
 * this module works with a plain string or `null`, never `process` itself.
 *
 * `process` is declared locally (below) rather than relying on `@types/node`
 * ambient globals: apps/mobile's tsconfig sets `"types": []`, and unlike
 * `tsc -b`'s single shared program (where one file's `/// <reference
 * types="node" />` — `src/lint-rules/copy-scan.test.ts` — makes `process`
 * visible everywhere, per that file's own correction note), ESLint's
 * type-aware linting does not pick that up for this file, which would
 * otherwise leave `process.env.EXPO_PUBLIC_API_URL` typed `any`. A local
 * `declare const` is the same shadowing pattern
 * `src/lint-rules/domain-boundary.test.ts` already uses, self-contained and
 * independent of that leak either way.
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

/**
 * The API's base URL, or `null` when unset. `src/api/client.ts` reads this
 * once to decide which `ApiClient` implementation to use: `HttpApiClient`
 * against a real API when set, the in-memory `FixtureApiClient` otherwise
 * (BACKLOG.md M3-T3 Objective (d): "used when the variable is set, otherwise
 * the fixture client").
 */
export function getApiBaseUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_API_URL;
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `HttpApiClient`'s fallback identity token (M3-T4d): restated, not
 * imported from `src/api/client.ts`'s `FIXTURE_IDENTITY_TOKEN`, because that
 * module already imports {@link getApiBaseUrl} from this one and a cycle
 * back the other way would follow. `tests/fixtures/identity/README.md`'s
 * Dean Chen entry is the single source of truth for the literal string
 * itself; `src/api/client.ts/FixtureApiClient.getIdentityToken` keeps
 * returning its own constant unconditionally (never reads this variable),
 * so the fixture-backed app's identity is unaffected either way.
 */
const DEFAULT_IDENTITY_TOKEN = "fixture.dean.chen";

/**
 * The bearer token `HttpApiClient` authenticates every request with
 * (M3-T4d Objective (e)): `EXPO_PUBLIC_IDENTITY_TOKEN` when set to a
 * non-blank value, else {@link DEFAULT_IDENTITY_TOKEN}. Lets the app run as
 * a different fixture identity (for example `fixture.new.user`, the one
 * with no household yet, or `fixture.maya.chen`) without a code change,
 * same trim/blank rule as {@link getApiBaseUrl}. Only `HttpApiClient` reads
 * this; the value has no effect on the fixture-backed app.
 */
export function getIdentityToken(): string {
  const value = process.env.EXPO_PUBLIC_IDENTITY_TOKEN;
  if (value === undefined) {
    return DEFAULT_IDENTITY_TOKEN;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_IDENTITY_TOKEN;
}
