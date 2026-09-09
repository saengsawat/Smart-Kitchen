/**
 * `@smart-kitchen/adapters` — provider ports + fixture/live implementations
 * (product lookup, nutrition, and later LLM/OCR — ai-architecture.md §3).
 *
 * - `product-lookup` — `ProductLookupPort`/`NutritionSourcePort` + their
 *   fixture-backed implementations (M1-T5).
 */

export const ADAPTERS_PACKAGE_NAME = "@smart-kitchen/adapters";

export * from "./product-lookup/index.js";
