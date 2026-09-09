/**
 * Repo-relative paths to the fixture corpus, resolved from this module's own
 * location (`import.meta.url`) rather than `process.cwd()` — so fixture
 * reads work the same whether tests run from the repo root, a package
 * directory, or CI's checkout path (M1-T5 dispatch note: "fixture-reading
 * tests must work in CI (relative paths from repo root or robust
 * resolution)").
 *
 * `packages/adapters/src/product-lookup/fixture-paths.ts` and its compiled
 * `packages/adapters/dist/product-lookup/fixture-paths.js` sit at the same
 * depth under the repo root (`src`/`dist` are siblings), so the same
 * four-levels-up walk resolves correctly for both the source (tests run
 * directly against `.ts`) and the built output.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(moduleDir, "..", "..", "..", "..");

export const PRODUCTS_FIXTURES_DIR = path.join(REPO_ROOT, "tests", "fixtures", "products");
export const BARCODES_FIXTURES_DIR = path.join(REPO_ROOT, "tests", "fixtures", "barcodes");
export const BARCODES_MANIFEST_PATH = path.join(BARCODES_FIXTURES_DIR, "manifest.json");
