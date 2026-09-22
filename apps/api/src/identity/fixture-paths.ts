/**
 * Repo-relative path to the identity fixture map, resolved from this module's
 * own location rather than `process.cwd()`, for the same reasoning as
 * `packages/adapters/src/product-lookup/fixture-paths.ts`: fixture reads must
 * work whether tests run from the repo root, a package directory, or CI's
 * checkout path.
 *
 * `apps/api/src/identity/fixture-paths.ts` and its compiled
 * `apps/api/dist/identity/fixture-paths.js` sit at the same depth under the
 * repo root (`src` and `dist` are siblings), so one four-levels-up walk is
 * correct for both.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(moduleDir, "..", "..", "..", "..");

export const IDENTITY_FIXTURES_DIR = path.join(REPO_ROOT, "tests", "fixtures", "identity");

export const IDENTITY_SESSIONS_FIXTURE_PATH = path.join(IDENTITY_FIXTURES_DIR, "sessions.json");
