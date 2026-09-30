/**
 * Open Food Facts adapter configuration (M2-T4a, D-025).
 *
 * Every value here was checked against OFF's own API documentation on
 * 2026-09-29 (https://openfoodfacts.github.io/openfoodfacts-server/api/ and
 * the v2 OpenAPI reference it links); the worker report for M2-T4a records
 * what each page said. Nothing here is a secret: the staging host's basic
 * auth pair is published by OFF in that same page ("The username is off, and
 * the password off") and only exists to keep search engines out of staging.
 */

/** OFF production. D-025: development traffic within OFF's published limits. */
export const OFF_PRODUCTION_BASE_URL = "https://world.openfoodfacts.org";

/** OFF staging, for manual developer testing only. The automated suite never calls it (rule 18). */
export const OFF_STAGING_BASE_URL = "https://world.openfoodfacts.net";

/**
 * The staging host's published basic auth ("off"/"off"), sent only to that
 * host. Not a credential in any meaningful sense: OFF documents it so that
 * any developer can read staging, and it grants no write access.
 */
const OFF_STAGING_HOST = "world.openfoodfacts.net";
const OFF_STAGING_AUTHORIZATION = `Basic ${Buffer.from("off:off", "utf8").toString("base64")}`;

/**
 * Default User-Agent. OFF asks every client to identify itself as
 * `AppName/Version (ContactEmail)`; this default carries a project URL
 * instead of an email so that no personal data ships in code. A deployment
 * that wants OFF to be able to reach a person sets `SK_OFF_USER_AGENT`.
 */
export const OFF_DEFAULT_USER_AGENT =
  "SmartKitchen/0.1 (development; https://github.com/saengsawat/Smart-Kitchen)";

/**
 * The explicit field list sent as `fields=` on every product read (BACKLOG.md
 * M2-T4a (a)). Each name is a documented product field in OFF's v2 schema
 * (`docs/api/ref/schemas/product_*.yaml`); see the worker report, section 2.
 */
export const OFF_PRODUCT_FIELDS = [
  "code",
  "product_name",
  /**
   * M2-T4b (c): OFF's English name, requested as a fallback when the
   * record's main-language `product_name` is empty (a garbled OCR label, an
   * un-backfilled contributor entry). Falling back to this is still better
   * than `not-found` for a product OFF genuinely knows; a record with
   * neither stays `not-found` (mapping.ts).
   */
  "product_name_en",
  "brands",
  "quantity",
  "serving_size",
  "ingredients_text",
  "allergens_tags",
  "traces_tags",
  "nutriments",
  /**
   * Whether OFF's `_100g`-suffixed nutriment values are actually per 100 g
   * or per 100 ml (M3-T4e, ADR-006 open item): OFF reuses the same `_100g`
   * key suffix for both a mass-based and a volume-based product, and this
   * field is the only signal that distinguishes them. `mapping.ts`'s
   * `nutritionProfiles` reads it and emits no `PER_100G` profile unless it
   * is exactly `"100g"`, so a liquid's per-100-ml figures are never shown
   * under a per-100-g label.
   */
  "nutrition_data_per",
  "categories_tags",
  "image_front_url",
  "last_modified_t",
] as const;

/** Per-request timeout, covering connect, headers and body (BACKLOG.md M2-T4a (a)). */
export const OFF_REQUEST_TIMEOUT_MS = 5_000;

/**
 * OFF's published read limit for product queries, as documented on
 * 2026-09-29: "15 req/min/IP address for all read product queries (GET
 * /api/v*\/product requests or product page)". The ticket text said 100 per
 * minute; the published figure is 15, and the throttle is set from the
 * published figure (worker report, section 7).
 */
export const OFF_PUBLISHED_PRODUCT_READS_PER_MINUTE = 15;

/**
 * This process's outbound budget: 12 product reads per rolling minute, so a
 * single API process stays under the published 15 with headroom for a
 * developer running a manual curl from the same IP. Cache hits and
 * in-flight de-duplication do not spend it.
 */
export const OFF_DEFAULT_THROTTLE = Object.freeze({ limit: 12, windowMs: 60_000 });

/**
 * After a 429 or a 503 (OFF's documented answer when its global limits are
 * hit), send nothing for this long. OFF reserves the right to ban an IP that
 * keeps hitting its limits, so backing off is the only polite answer.
 */
export const OFF_COOLDOWN_MS = 60_000;

/** In-memory cache lifetime for a found product (per process, no table, no file: R-4 untouched). */
export const OFF_HIT_TTL_MS = 30 * 60_000;

/** Shorter lifetime for a miss, so a product added to OFF shows up again soon. */
export const OFF_NOT_FOUND_TTL_MS = 5 * 60_000;

/** Upper bound on cached codes per process; the oldest entry is evicted first. */
export const OFF_CACHE_MAX_ENTRIES = 1_000;

/** A response body larger than this is refused as malformed rather than parsed. */
export const OFF_MAX_BODY_CHARS = 2_000_000;

/** Names this module reads from the environment (`.env.example` lists them). */
export interface OffEnvironment {
  readonly SK_OFF_BASE_URL?: string | undefined;
  readonly SK_OFF_USER_AGENT?: string | undefined;
}

export interface OffConfig {
  readonly baseUrl: string;
  readonly userAgent: string;
}

export class OffConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffConfigurationError";
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Validates a base URL: `https` anywhere, plain `http` only on a loopback
 * host (a local stub during development). A trailing slash is dropped so the
 * request path joins cleanly.
 */
export function normalizeOffBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new OffConfigurationError("SK_OFF_BASE_URL is not a valid URL. See .env.example.");
  }
  const secure = url.protocol === "https:";
  const localPlain = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (!secure && !localPlain) {
    throw new OffConfigurationError(
      "SK_OFF_BASE_URL must use https (plain http is accepted only for localhost). See .env.example.",
    );
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new OffConfigurationError(
      "SK_OFF_BASE_URL must be a bare origin and path, with no credentials, query or fragment.",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

/** Validates a User-Agent: one printable line, not empty. */
export function normalizeOffUserAgent(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 200 || /[\p{Cc}]/u.test(trimmed)) {
    throw new OffConfigurationError(
      "SK_OFF_USER_AGENT must be one printable line of at most 200 characters.",
    );
  }
  return trimmed;
}

/** Reads `SK_OFF_BASE_URL` and `SK_OFF_USER_AGENT`, falling back to the documented defaults. */
export function offConfigFromEnvironment(env: OffEnvironment): OffConfig {
  const base = env.SK_OFF_BASE_URL;
  const agent = env.SK_OFF_USER_AGENT;
  return {
    baseUrl: normalizeOffBaseUrl(
      base === undefined || base.trim() === "" ? OFF_PRODUCTION_BASE_URL : base,
    ),
    userAgent: normalizeOffUserAgent(
      agent === undefined || agent.trim() === "" ? OFF_DEFAULT_USER_AGENT : agent,
    ),
  };
}

/** The `Authorization` header for a base URL: the published staging pair on the staging host, nothing anywhere else. */
export function offAuthorizationFor(baseUrl: string): string | undefined {
  return new URL(baseUrl).hostname === OFF_STAGING_HOST ? OFF_STAGING_AUTHORIZATION : undefined;
}
