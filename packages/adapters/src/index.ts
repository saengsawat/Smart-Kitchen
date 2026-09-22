/**
 * `@smart-kitchen/adapters` — provider ports + fixture/live implementations
 * (product lookup, nutrition, and later LLM/OCR — ai-architecture.md §3).
 *
 * - `product-lookup` — `ProductLookupPort`/`NutritionSourcePort` + their
 *   fixture-backed implementations (M1-T5).
 * - `inventory`: fixture inventory items for the mobile client's fixture
 *   `ApiClient` (M3-T1); see inventory/fixture-inventory-items.ts for why
 *   these exist and how they were built.
 */

export const ADAPTERS_PACKAGE_NAME = "@smart-kitchen/adapters";

export * from "./product-lookup/index.js";
export * from "./inventory/fixture-inventory-items.js";
