/**
 * `@smart-kitchen/adapters` — provider ports + fixture/live implementations
 * (product lookup, nutrition, and later LLM/OCR — ai-architecture.md §3).
 *
 * - `product-lookup` — `ProductLookupPort`/`NutritionSourcePort` + their
 *   fixture-backed implementations (M1-T5).
 * - `contracts-consistency` — cross-checks that hand-written contract lists
 *   (which cannot import `@smart-kitchen/domain`) still match the domain's
 *   own lists; test-only, nothing exported from here.
 *
 * M3-T1's `inventory/fixture-inventory-items.ts` (fixture rows for the mobile
 * client's fixture `ApiClient`, built through the real domain ledger
 * functions) is removed as of M3-T3: nothing imported it once M3-T2 moved the
 * mobile fixture client onto contracts-shaped literals (see
 * `apps/mobile/src/api/client.ts`'s doc comment), and M3-T3 drops
 * `@smart-kitchen/adapters` from `apps/mobile` entirely, closing the M3-T1
 * review's own open question about this file's fate ("decide whether the
 * ledger-built fixtures become the real tests/fixtures/inventories/ corpus"):
 * they do not, since the mobile client no longer reads fixtures through this
 * package at all.
 */

export const ADAPTERS_PACKAGE_NAME = "@smart-kitchen/adapters";

export * from "./product-lookup/index.js";
