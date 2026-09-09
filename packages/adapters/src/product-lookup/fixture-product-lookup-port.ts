/**
 * Fixture-backed {@link ProductLookupPort} — reads `tests/fixtures/products`
 * + `tests/fixtures/barcodes/manifest.json` via `fixture-loader.ts`. This is
 * the implementation used in tests, local dev, and demos per
 * ai-architecture.md §3 ("Every port has a fixture implementation... no live
 * keys needed to develop"). A live Open Food Facts / USDA FDC adapter (M4)
 * would implement the same `ProductLookupPort` interface and is not part of
 * this ticket.
 */

import { codeKey, loadFixtureCatalog } from "./fixture-loader.js";
import { validateCodeFormat } from "./schema.js";
import type { ProductLookupPort, ResolveResult } from "./ports.js";
import type { ProductCode } from "./types.js";

export class FixtureProductLookupPort implements ProductLookupPort {
  resolve(code: ProductCode): Promise<ResolveResult> {
    const formatProblem = validateCodeFormat(code);
    if (formatProblem) {
      return Promise.resolve({
        status: "error",
        code,
        error: { code: "INVALID_CODE", message: formatProblem.message, field: "code" },
      });
    }

    const catalog = loadFixtureCatalog();
    if (!catalog.ok) {
      return Promise.resolve({ status: "error", code, error: catalog.error });
    }

    const product = catalog.value.byCode.get(codeKey(code));
    if (!product) {
      return Promise.resolve({ status: "not-found", code });
    }
    return Promise.resolve({ status: "hit", code, product });
  }
}
