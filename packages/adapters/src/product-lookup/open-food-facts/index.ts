/** Open Food Facts live product lookup (M2-T4a, D-025). Server side only. */

export { OpenFoodFactsProductLookupPort } from "./open-food-facts-port.js";
export type { FetchLike, OpenFoodFactsPortOptions } from "./open-food-facts-port.js";
export {
  OFF_CACHE_MAX_ENTRIES,
  OFF_COOLDOWN_MS,
  OFF_DEFAULT_THROTTLE,
  OFF_DEFAULT_USER_AGENT,
  OFF_HIT_TTL_MS,
  OFF_NOT_FOUND_TTL_MS,
  OFF_PRODUCT_FIELDS,
  OFF_PRODUCTION_BASE_URL,
  OFF_PUBLISHED_PRODUCT_READS_PER_MINUTE,
  OFF_REQUEST_TIMEOUT_MS,
  OFF_STAGING_BASE_URL,
  OffConfigurationError,
  offConfigFromEnvironment,
} from "./config.js";
export type { OffConfig, OffEnvironment } from "./config.js";
export { OFF_ALLERGEN_TAG_MAP, mapOffAllergenTag } from "./allergen-tag-map.js";
export { OFF_SOURCE, gramsToMilligrams, mapOffAnswer, sameGtin } from "./mapping.js";
export type { OffHttpAnswer, OffMappedOutcome } from "./mapping.js";
export { parseOffQuantity } from "./parse-quantity.js";
export type { ParsedQuantity } from "./parse-quantity.js";
