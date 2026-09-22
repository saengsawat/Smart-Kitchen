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
