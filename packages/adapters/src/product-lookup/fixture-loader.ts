/**
 * Loads and validates the fixture corpus (`tests/fixtures/products/**.json`
 * + `tests/fixtures/barcodes/manifest.json`) into an in-memory catalog the
 * fixture-backed ports read from. This is the **only** I/O in the
 * product-lookup module, and it only ever touches these two fixture paths
 * (M1-T5 invariant: "no I/O outside the fixtures dir").
 *
 * Loaded once per process and cached — the fixture corpus is static test
 * data, not something that changes mid-run.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { err, ok, type Outcome } from "./errors.js";
import { BARCODES_MANIFEST_PATH, PRODUCTS_FIXTURES_DIR } from "./fixture-paths.js";
import {
  validateBarcodeManifestEntry,
  validateProductFixture,
  type BarcodeManifestEntry,
} from "./schema.js";
import type { ProductCatalogItem, ProductCode } from "./types.js";

/** Stable lookup key for a code, combining its type since e.g. a GTIN-13 and a UPC-A can share digits. */
export function codeKey(code: ProductCode): string {
  return `${code.codeType}:${code.code}`;
}

export interface FixtureCatalog {
  readonly products: readonly ProductCatalogItem[];
  readonly byId: ReadonlyMap<string, ProductCatalogItem>;
  readonly byCode: ReadonlyMap<string, ProductCatalogItem>;
  readonly manifest: readonly BarcodeManifestEntry[];
}

let cachedCatalog: Outcome<FixtureCatalog> | undefined;

/** Loads (and memoizes) the fixture catalog. Never throws — read/parse/schema failures are a typed error. */
export function loadFixtureCatalog(): Outcome<FixtureCatalog> {
  cachedCatalog ??= buildCatalog();
  return cachedCatalog;
}

/** Test-only: forces the next {@link loadFixtureCatalog} call to reload from disk. */
export function resetFixtureCatalogCache(): void {
  cachedCatalog = undefined;
}

function buildCatalog(): Outcome<FixtureCatalog> {
  let filenames: string[];
  try {
    filenames = readdirSync(PRODUCTS_FIXTURES_DIR).filter((name) => name.endsWith(".json"));
  } catch (cause) {
    return err(
      "FIXTURE_NOT_READABLE",
      `cannot read fixture directory ${PRODUCTS_FIXTURES_DIR}: ${String(cause)}`,
    );
  }
  filenames.sort();

  const products: ProductCatalogItem[] = [];
  const byId = new Map<string, ProductCatalogItem>();
  const byCode = new Map<string, ProductCatalogItem>();

  for (const filename of filenames) {
    const fullPath = path.join(PRODUCTS_FIXTURES_DIR, filename);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(fullPath, "utf8")) as unknown;
    } catch (cause) {
      return err(
        "FIXTURE_NOT_READABLE",
        `cannot read/parse ${filename}: ${String(cause)}`,
        filename,
      );
    }
    const validated = validateProductFixture(raw, filename);
    if (!validated.ok) return validated;
    const product = validated.value;

    if (byId.has(product.id)) {
      return err(
        "FIXTURE_SCHEMA_INVALID",
        `duplicate product id "${product.id}" (${filename} collides with an earlier fixture)`,
        filename,
      );
    }
    byId.set(product.id, product);
    products.push(product);

    for (const code of product.codes) {
      const key = codeKey(code);
      const existing = byCode.get(key);
      if (existing) {
        return err(
          "FIXTURE_SCHEMA_INVALID",
          `code ${key} is claimed by both "${existing.id}" and "${product.id}" — one product per code; ` +
            `represent a multi-source-conflict as multiple nutrition profiles on ONE product, not two ` +
            `products sharing a code`,
          key,
        );
      }
      byCode.set(key, product);
    }
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(readFileSync(BARCODES_MANIFEST_PATH, "utf8")) as unknown;
  } catch (cause) {
    return err(
      "FIXTURE_NOT_READABLE",
      `cannot read/parse ${BARCODES_MANIFEST_PATH}: ${String(cause)}`,
    );
  }
  if (!Array.isArray(manifestRaw)) {
    return err("FIXTURE_SCHEMA_INVALID", "barcodes/manifest.json must be a JSON array");
  }
  const manifest: BarcodeManifestEntry[] = [];
  for (let i = 0; i < manifestRaw.length; i++) {
    const path_ = `manifest[${String(i)}]`;
    const validated = validateBarcodeManifestEntry(manifestRaw[i], path_);
    if (!validated.ok) return validated;
    const entry = validated.value;
    if (entry.expect === "hit" && entry.productId !== undefined && !byId.has(entry.productId)) {
      return err(
        "FIXTURE_REFERENCE_NOT_FOUND",
        `${path_} references productId "${entry.productId}", which has no fixture in tests/fixtures/products/`,
        path_,
      );
    }
    manifest.push(entry);
  }

  return ok({ products, byId, byCode, manifest });
}
