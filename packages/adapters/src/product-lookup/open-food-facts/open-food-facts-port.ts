/**
 * `ProductLookupPort` over the Open Food Facts v2 product endpoint
 * (M2-T4a (a), D-025). Server side only: the phone never calls OFF.
 *
 * What one `resolve` does, in order:
 *
 * 1. refuses a malformed code, and refuses every PLU outright (ADR-006: a
 *    PLU never goes through a barcode lookup), without sending anything;
 * 2. answers from the in-memory TTL cache when it can (hits and misses are
 *    cached, errors never are);
 * 3. joins an identical request already in flight instead of sending a
 *    second one;
 * 4. refuses to send while a cooldown from a 429 or 503 is running, or when
 *    this process has spent its rolling budget (`OFF_DEFAULT_THROTTLE`);
 * 5. sends `GET {base}/api/v2/product/{code}.json?fields=...` with the
 *    configured User-Agent and a 5 s timeout covering the whole exchange;
 * 6. maps the answer (`mapping.ts`), where 429, 5xx, a timeout, a network
 *    failure and an unreadable body are all `error`, never `not-found`.
 *
 * It never throws: every path ends in a typed `ResolveResult`. It never
 * logs the response body (it logs nothing at all; the route logs the
 * outcome and the code).
 */

import type { AdapterError } from "../errors.js";
import type { ProductLookupPort, ResolveResult } from "../ports.js";
import { validateCodeFormat } from "../schema.js";
import type { ProductCatalogItem, ProductCode } from "../types.js";
import {
  OFF_CACHE_MAX_ENTRIES,
  OFF_COOLDOWN_MS,
  OFF_DEFAULT_THROTTLE,
  OFF_DEFAULT_USER_AGENT,
  OFF_HIT_TTL_MS,
  OFF_NOT_FOUND_TTL_MS,
  OFF_PRODUCT_FIELDS,
  OFF_PRODUCTION_BASE_URL,
  OFF_REQUEST_TIMEOUT_MS,
  normalizeOffBaseUrl,
  normalizeOffUserAgent,
  offAuthorizationFor,
} from "./config.js";
import { mapOffAnswer } from "./mapping.js";
import { SlidingWindowThrottle } from "./throttle.js";
import { TtlCache } from "./ttl-cache.js";

/** The subset of the global `fetch` this port uses, so a test can hand it a stub. */
export type FetchLike = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Record<string, string>;
    readonly signal: AbortSignal;
  },
) => Promise<{ readonly status: number; text(): Promise<string> }>;

export interface OpenFoodFactsPortOptions {
  /** Defaults to OFF production. */
  readonly baseUrl?: string;
  /** Defaults to {@link OFF_DEFAULT_USER_AGENT}. */
  readonly userAgent?: string;
  /** Defaults to the Node 20 global `fetch`. */
  readonly fetch?: FetchLike;
  /** Milliseconds clock for the throttle, cooldown and cache; defaults to `Date.now`. */
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly throttle?: { readonly limit: number; readonly windowMs: number };
  readonly cooldownMs?: number;
  readonly hitTtlMs?: number;
  readonly notFoundTtlMs?: number;
  readonly cacheMaxEntries?: number;
}

type CachedOutcome =
  | { readonly status: "hit"; readonly product: ProductCatalogItem }
  | { readonly status: "not-found" };

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export class OpenFoodFactsProductLookupPort implements ProductLookupPort {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly authorization: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;
  private readonly hitTtlMs: number;
  private readonly notFoundTtlMs: number;
  private readonly throttle: SlidingWindowThrottle;
  private readonly cache: TtlCache<CachedOutcome>;
  private readonly inFlight = new Map<string, Promise<ResolveResult>>();
  private cooldownUntil = 0;

  constructor(options: OpenFoodFactsPortOptions = {}) {
    this.baseUrl = normalizeOffBaseUrl(options.baseUrl ?? OFF_PRODUCTION_BASE_URL);
    this.userAgent = normalizeOffUserAgent(options.userAgent ?? OFF_DEFAULT_USER_AGENT);
    this.authorization = offAuthorizationFor(this.baseUrl);
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? OFF_REQUEST_TIMEOUT_MS;
    this.cooldownMs = options.cooldownMs ?? OFF_COOLDOWN_MS;
    this.hitTtlMs = options.hitTtlMs ?? OFF_HIT_TTL_MS;
    this.notFoundTtlMs = options.notFoundTtlMs ?? OFF_NOT_FOUND_TTL_MS;
    const budget = options.throttle ?? OFF_DEFAULT_THROTTLE;
    this.throttle = new SlidingWindowThrottle(budget.limit, budget.windowMs, this.now);
    this.cache = new TtlCache(options.cacheMaxEntries ?? OFF_CACHE_MAX_ENTRIES, this.now);
  }

  /** The URL a lookup for `code` is sent to (exported for the request-shape test). */
  productUrl(code: string): string {
    return `${this.baseUrl}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_PRODUCT_FIELDS.join(",")}`;
  }

  resolve(code: ProductCode): Promise<ResolveResult> {
    const formatProblem = validateCodeFormat(code);
    if (formatProblem) {
      return Promise.resolve(
        errorResult(code, { code: "INVALID_CODE", message: formatProblem.message, field: "code" }),
      );
    }
    if (code.codeType === "PLU") {
      return Promise.resolve(
        errorResult(code, {
          code: "INVALID_CODE",
          message: "a PLU is never sent through a barcode lookup (ADR-006)",
          field: "code",
        }),
      );
    }

    // Review F3: one product, one entry. `096619555505` and `0096619555505`
    // are the same GTIN (OFF normalizes both to 13 digits), so they share one
    // cache entry, one in-flight request and one budget slot.
    const key = cacheKey(code.code);
    const cached = this.cache.get(key);
    if (cached !== undefined) return Promise.resolve(withCode(code, cached));

    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending.then((result) => restamp(code, result));

    const request = this.send(code, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, request);
    return request;
  }

  private async send(code: ProductCode, key: string): Promise<ResolveResult> {
    if (this.now() < this.cooldownUntil) {
      return errorResult(code, {
        code: "UPSTREAM_RATE_LIMITED",
        message: "not sending: cooling down after Open Food Facts refused a request",
      });
    }
    if (!this.throttle.tryAcquire()) {
      return errorResult(code, {
        code: "UPSTREAM_RATE_LIMITED",
        message: "not sending: this process's Open Food Facts request budget is spent",
      });
    }

    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
    if (this.authorization !== undefined) headers["Authorization"] = this.authorization;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    let httpStatus: number;
    let bodyText: string;
    try {
      const response = await this.fetchImpl(this.productUrl(code.code), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      httpStatus = response.status;
      bodyText = await response.text();
    } catch {
      return errorResult(
        code,
        controller.signal.aborted
          ? {
              code: "UPSTREAM_TIMEOUT",
              message: `Open Food Facts did not answer within ${String(this.timeoutMs)} ms`,
            }
          : { code: "UPSTREAM_UNAVAILABLE", message: "Open Food Facts could not be reached" },
      );
    } finally {
      clearTimeout(timer);
    }

    if (httpStatus === 429 || httpStatus === 503) {
      this.cooldownUntil = this.now() + this.cooldownMs;
    }

    let mapped;
    try {
      mapped = mapOffAnswer({ httpStatus, bodyText }, code, new Date(this.now()).toISOString());
    } catch {
      // A mapping bug must still end in a typed error, never a throw and never a miss.
      return errorResult(code, {
        code: "UPSTREAM_MALFORMED",
        message: "Open Food Facts answer could not be mapped",
      });
    }
    if (mapped.status === "error") return errorResult(code, mapped.error);
    this.cache.set(key, mapped, mapped.status === "hit" ? this.hitTtlMs : this.notFoundTtlMs);
    return withCode(code, mapped);
  }
}

function errorResult(code: ProductCode, error: AdapterError): ResolveResult {
  return { status: "error", code, error };
}

/**
 * The cache and in-flight key: the 13-digit GTIN form for 8 to 13 digit
 * codes (M2-T4b (e): EAN-8 is padded too, so an EAN-8 and its 13-digit
 * spelling share one entry). Anything longer is left as is.
 */
export function cacheKey(digits: string): string {
  return digits.length <= 13 ? digits.padStart(13, "0") : digits;
}

/**
 * A shared entry answers with the identity of the code *this* caller asked
 * for (id and codes), so which spelling filled the cache never leaks into
 * another caller's `productId`.
 */
function withCode(code: ProductCode, outcome: CachedOutcome): ResolveResult {
  return outcome.status === "hit"
    ? {
        status: "hit",
        code,
        product: {
          ...outcome.product,
          id: code.code,
          codes: [{ codeType: code.codeType, code: code.code }],
        },
      }
    : { status: "not-found", code };
}

function restamp(code: ProductCode, result: ResolveResult): ResolveResult {
  if (result.status === "error") return { ...result, code };
  return withCode(code, result);
}
