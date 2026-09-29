/**
 * `OpenFoodFactsProductLookupPort` (M2-T4a (a)): request shape, outcome
 * mapping on the transport, throttle, cooldown, cache and in-flight
 * de-duplication. Every test hands the port a stub `fetch` that replays a
 * recorded response or simulates a failure; nothing here opens a connection.
 */

import { describe, expect, it } from "vitest";
import type { ResolveResult } from "../ports.js";
import type { ProductCode } from "../types.js";
import {
  OFF_DEFAULT_USER_AGENT,
  OFF_PRODUCT_FIELDS,
  OFF_STAGING_BASE_URL,
  OffConfigurationError,
  offConfigFromEnvironment,
} from "./config.js";
import { OpenFoodFactsProductLookupPort, type FetchLike } from "./open-food-facts-port.js";
import { recordedAnswer, recordedCode, type RecordedOffFile } from "./test-support.js";

interface SentRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** A stub `fetch` that answers from a script and records every request. */
function stubFetch(answer: (url: string) => Promise<{ status: number; body: string }>): {
  readonly fetch: FetchLike;
  readonly sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, headers: { ...init.headers } });
    const { status, body } = await answer(url);
    return { status, text: () => Promise.resolve(body) };
  };
  return { fetch, sent };
}

function replay(file: RecordedOffFile): () => Promise<{ status: number; body: string }> {
  const { httpStatus, bodyText } = recordedAnswer(file);
  return () => Promise.resolve({ status: httpStatus, body: bodyText });
}

const PEANUT_BUTTER: ProductCode = {
  codeType: "UPC_A",
  code: recordedCode("full-peanut-butter.json"),
};
const GRANOLA: ProductCode = { codeType: "UPC_A", code: recordedCode("traces-only-granola.json") };
const MISSING: ProductCode = { codeType: "UPC_A", code: recordedCode("not-found.json") };

class FakeClock {
  t = 1_000_000;
  readonly now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

function errorCode(result: ResolveResult): string | undefined {
  return result.status === "error" ? result.error.code : undefined;
}

describe("request shape", () => {
  it("sends GET {base}/api/v2/product/{code}.json with the explicit field list and the User-Agent", async () => {
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    const result = await port.resolve(PEANUT_BUTTER);

    expect(result.status).toBe("hit");
    expect(sent).toHaveLength(1);
    const url = new URL(sent[0]?.url ?? "");
    expect(url.origin).toBe("https://world.openfoodfacts.org");
    expect(url.pathname).toBe("/api/v2/product/096619555505.json");
    expect(url.searchParams.get("fields")?.split(",")).toEqual([...OFF_PRODUCT_FIELDS]);
    expect(sent[0]?.headers["User-Agent"]).toBe(OFF_DEFAULT_USER_AGENT);
    expect(sent[0]?.headers["Accept"]).toBe("application/json");
    expect(sent[0]?.headers["Authorization"]).toBeUndefined();
  });

  it("the field list is exactly the ticket's (plus M3-T4e's nutrition_data_per)", () => {
    expect([...OFF_PRODUCT_FIELDS]).toEqual([
      "code",
      "product_name",
      "brands",
      "quantity",
      "serving_size",
      "ingredients_text",
      "allergens_tags",
      "traces_tags",
      "nutriments",
      "nutrition_data_per",
      "categories_tags",
      "image_front_url",
      "last_modified_t",
    ]);
  });

  it("the default User-Agent names the app and carries no email or personal data", () => {
    expect(OFF_DEFAULT_USER_AGENT).toMatch(/^SmartKitchen\/\d+\.\d+ \(/);
    expect(OFF_DEFAULT_USER_AGENT).not.toMatch(/@/);
  });

  it("uses a configured User-Agent and base URL, and sends the published staging auth only to staging", async () => {
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({
      fetch,
      baseUrl: `${OFF_STAGING_BASE_URL}/`,
      userAgent: "SmartKitchen/0.1 (ops@example.invalid)",
    });
    await port.resolve(PEANUT_BUTTER);
    expect(sent[0]?.url.startsWith("https://world.openfoodfacts.net/api/v2/product/")).toBe(true);
    expect(sent[0]?.headers["User-Agent"]).toBe("SmartKitchen/0.1 (ops@example.invalid)");
    expect(sent[0]?.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("off:off").toString("base64")}`,
    );
  });

  it("never sends the staging auth to any other host", async () => {
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({ fetch, baseUrl: "http://127.0.0.1:4010" });
    await port.resolve(PEANUT_BUTTER);
    expect(sent[0]?.url.startsWith("http://127.0.0.1:4010/api/v2/product/")).toBe(true);
    expect(sent[0]?.headers["Authorization"]).toBeUndefined();
  });
});

describe("codes that are never sent", () => {
  it("a PLU is refused without a request (ADR-006)", async () => {
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    for (const code of ["4011", "94011"]) {
      const result = await port.resolve({ codeType: "PLU", code });
      expect(errorCode(result)).toBe("INVALID_CODE");
    }
    expect(sent).toHaveLength(0);
  });

  it("a code that fails its check digit or length is refused without a request", async () => {
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    expect(errorCode(await port.resolve({ codeType: "UPC_A", code: "096619555504" }))).toBe(
      "INVALID_CODE",
    );
    expect(errorCode(await port.resolve({ codeType: "EAN13", code: "12345" }))).toBe(
      "INVALID_CODE",
    );
    expect(sent).toHaveLength(0);
  });
});

describe("transport outcomes", () => {
  it("the recorded status-0 404 is not-found, with the asked code kept", async () => {
    const { fetch } = stubFetch(replay("not-found.json"));
    const result = await new OpenFoodFactsProductLookupPort({ fetch }).resolve(MISSING);
    expect(result).toEqual({ status: "not-found", code: MISSING });
  });

  it.each([
    [429, "UPSTREAM_RATE_LIMITED"],
    [500, "UPSTREAM_UNAVAILABLE"],
    [503, "UPSTREAM_UNAVAILABLE"],
    [403, "UPSTREAM_REJECTED"],
  ])("HTTP %d is error %s", async (status, code) => {
    const { fetch } = stubFetch(() => Promise.resolve({ status, body: "" }));
    const result = await new OpenFoodFactsProductLookupPort({ fetch }).resolve(PEANUT_BUTTER);
    expect(errorCode(result)).toBe(code);
  });

  it("malformed JSON is error, never not-found", async () => {
    const { fetch } = stubFetch(() => Promise.resolve({ status: 200, body: '{"status":1,"prod' }));
    const result = await new OpenFoodFactsProductLookupPort({ fetch }).resolve(PEANUT_BUTTER);
    expect(errorCode(result)).toBe("UPSTREAM_MALFORMED");
  });

  it("a network failure is error UPSTREAM_UNAVAILABLE", async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError("fetch failed"));
    const result = await new OpenFoodFactsProductLookupPort({ fetch }).resolve(PEANUT_BUTTER);
    expect(errorCode(result)).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("no answer within the timeout is error UPSTREAM_TIMEOUT, and the request is aborted", async () => {
    let aborted = false;
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const result = await new OpenFoodFactsProductLookupPort({ fetch, timeoutMs: 20 }).resolve(
      PEANUT_BUTTER,
    );
    expect(errorCode(result)).toBe("UPSTREAM_TIMEOUT");
    expect(aborted).toBe(true);
  });

  it("a body that stalls past the timeout is also UPSTREAM_TIMEOUT", async () => {
    const fetch: FetchLike = (_url, init) =>
      Promise.resolve({
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      });
    const result = await new OpenFoodFactsProductLookupPort({ fetch, timeoutMs: 20 }).resolve(
      PEANUT_BUTTER,
    );
    expect(errorCode(result)).toBe("UPSTREAM_TIMEOUT");
  });

  it("the default timeout is 5 s", async () => {
    const { OFF_REQUEST_TIMEOUT_MS } = await import("./config.js");
    expect(OFF_REQUEST_TIMEOUT_MS).toBe(5_000);
  });
});

describe("throttle (fake clock)", () => {
  it("refuses beyond the budget without sending, then allows again once the window rolls", async () => {
    const clock = new FakeClock();
    // OFF's miss body echoes the asked code, so this stub does too (the port
    // refuses an answer that names a different code as malformed).
    const { fetch, sent } = stubFetch((url) => {
      const code = /product\/(\d+)\.json/.exec(url)?.[1] ?? "";
      return Promise.resolve({
        status: 404,
        body: JSON.stringify({ code, status: 0, status_verbose: "product not found" }),
      });
    });
    const port = new OpenFoodFactsProductLookupPort({
      fetch,
      now: clock.now,
      throttle: { limit: 2, windowMs: 60_000 },
    });
    const codes = ["036000291452", "012000161155", "041570056189"];
    const first = await port.resolve({ codeType: "UPC_A", code: codes[0] ?? "" });
    clock.advance(1_000);
    const second = await port.resolve({ codeType: "UPC_A", code: codes[1] ?? "" });
    clock.advance(1_000);
    const third = await port.resolve({ codeType: "UPC_A", code: codes[2] ?? "" });

    expect(first.status).toBe("not-found");
    expect(second.status).toBe("not-found");
    expect(errorCode(third)).toBe("UPSTREAM_RATE_LIMITED");
    expect(sent).toHaveLength(2);

    clock.advance(58_000); // the first send is now 60 s old
    const fourth = await port.resolve({ codeType: "UPC_A", code: codes[2] ?? "" });
    expect(fourth.status).toBe("not-found");
    expect(sent).toHaveLength(3);
  });

  it("the default budget stays under OFF's published 15 product reads per minute", async () => {
    const { OFF_DEFAULT_THROTTLE, OFF_PUBLISHED_PRODUCT_READS_PER_MINUTE } =
      await import("./config.js");
    expect(OFF_PUBLISHED_PRODUCT_READS_PER_MINUTE).toBe(15);
    expect(OFF_DEFAULT_THROTTLE.windowMs).toBe(60_000);
    expect(OFF_DEFAULT_THROTTLE.limit).toBeLessThan(OFF_PUBLISHED_PRODUCT_READS_PER_MINUTE);
  });

  it("a cache hit does not spend the budget", async () => {
    const clock = new FakeClock();
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({
      fetch,
      now: clock.now,
      throttle: { limit: 1, windowMs: 60_000 },
    });
    for (let i = 0; i < 5; i++) {
      expect((await port.resolve(PEANUT_BUTTER)).status).toBe("hit");
    }
    expect(sent).toHaveLength(1);
  });
});

describe("cooldown after OFF refuses", () => {
  it.each([429, 503])("after a %d nothing is sent until the cooldown ends", async (status) => {
    const clock = new FakeClock();
    let answerStatus = status;
    const { fetch, sent } = stubFetch(() =>
      answerStatus === 200
        ? replay("full-peanut-butter.json")()
        : Promise.resolve({ status: answerStatus, body: "" }),
    );
    const port = new OpenFoodFactsProductLookupPort({ fetch, now: clock.now, cooldownMs: 60_000 });
    expect((await port.resolve(PEANUT_BUTTER)).status).toBe("error");
    answerStatus = 200;
    clock.advance(30_000);
    expect(errorCode(await port.resolve(PEANUT_BUTTER))).toBe("UPSTREAM_RATE_LIMITED");
    expect(sent).toHaveLength(1);
    clock.advance(30_000);
    expect((await port.resolve(PEANUT_BUTTER)).status).toBe("hit");
    expect(sent).toHaveLength(2);
  });

  it("a 500 does not start a cooldown", async () => {
    let status = 500;
    const { fetch, sent } = stubFetch(() =>
      status === 200 ? replay("full-peanut-butter.json")() : Promise.resolve({ status, body: "" }),
    );
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    await port.resolve(PEANUT_BUTTER);
    status = 200;
    expect((await port.resolve(PEANUT_BUTTER)).status).toBe("hit");
    expect(sent).toHaveLength(2);
  });
});

describe("in-memory cache (TTL and key)", () => {
  it("a hit is served from memory until its TTL, then fetched again", async () => {
    const clock = new FakeClock();
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({ fetch, now: clock.now, hitTtlMs: 10_000 });
    const first = await port.resolve(PEANUT_BUTTER);
    clock.advance(9_999);
    const second = await port.resolve(PEANUT_BUTTER);
    expect(second).toEqual(first);
    expect(sent).toHaveLength(1);
    clock.advance(1);
    await port.resolve(PEANUT_BUTTER);
    expect(sent).toHaveLength(2);
  });

  it("a miss is cached with its own, shorter TTL", async () => {
    const clock = new FakeClock();
    const { fetch, sent } = stubFetch(replay("not-found.json"));
    const port = new OpenFoodFactsProductLookupPort({
      fetch,
      now: clock.now,
      hitTtlMs: 60_000,
      notFoundTtlMs: 5_000,
    });
    await port.resolve(MISSING);
    clock.advance(4_999);
    expect((await port.resolve(MISSING)).status).toBe("not-found");
    expect(sent).toHaveLength(1);
    clock.advance(1);
    await port.resolve(MISSING);
    expect(sent).toHaveLength(2);
  });

  it("errors are never cached", async () => {
    let status = 500;
    const { fetch, sent } = stubFetch(() =>
      status === 200 ? replay("full-peanut-butter.json")() : Promise.resolve({ status, body: "" }),
    );
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    expect((await port.resolve(PEANUT_BUTTER)).status).toBe("error");
    status = 200;
    expect((await port.resolve(PEANUT_BUTTER)).status).toBe("hit");
    expect(sent).toHaveLength(2);
  });

  it("the key is the code: a different code is a different entry", async () => {
    const { fetch, sent } = stubFetch((url) =>
      url.includes(GRANOLA.code)
        ? replay("traces-only-granola.json")()
        : replay("full-peanut-butter.json")(),
    );
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    const a = await port.resolve(PEANUT_BUTTER);
    const b = await port.resolve(GRANOLA);
    await port.resolve(PEANUT_BUTTER);
    await port.resolve(GRANOLA);
    expect(sent).toHaveLength(2);
    expect(a.status === "hit" && a.product.name.value).toBe("Organic Creamy Peanut Butter");
    expect(b.status === "hit" && b.product.name.value).toBe("Triple Berry Crunch Granola");
  });

  it("is bounded: past the size limit the oldest code is evicted", async () => {
    const { fetch, sent } = stubFetch((url) =>
      url.includes(GRANOLA.code)
        ? replay("traces-only-granola.json")()
        : replay("full-peanut-butter.json")(),
    );
    const port = new OpenFoodFactsProductLookupPort({ fetch, cacheMaxEntries: 1 });
    await port.resolve(PEANUT_BUTTER);
    await port.resolve(GRANOLA);
    await port.resolve(PEANUT_BUTTER);
    expect(sent).toHaveLength(3);
  });
});

describe("one GTIN, one cache entry (review F3)", () => {
  const UPC: ProductCode = { codeType: "UPC_A", code: "096619555505" };
  const EAN: ProductCode = { codeType: "EAN13", code: "0096619555505" };

  it("the 12 and 13 digit spellings share one entry and one upstream request, each answered with its own identity", async () => {
    const { fetch, sent } = stubFetch(replay("full-peanut-butter.json"));
    const port = new OpenFoodFactsProductLookupPort({
      fetch,
      throttle: { limit: 1, windowMs: 60_000 },
    });
    const first = await port.resolve(UPC);
    const second = await port.resolve(EAN);

    expect(sent).toHaveLength(1);
    expect(first.status === "hit" && first.product.id).toBe("096619555505");
    expect(second.status === "hit" && second.product.id).toBe("0096619555505");
    expect(second.status === "hit" && second.product.codes).toEqual([EAN]);
    expect(second.code).toEqual(EAN);
  });

  it("concurrent lookups of the two spellings send one request", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetch, sent } = stubFetch(async () => {
      await gate;
      return replay("full-peanut-butter.json")();
    });
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    const a = port.resolve(UPC);
    const b = port.resolve(EAN);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(sent).toHaveLength(1);
    expect(ra.status === "hit" && ra.product.id).toBe("096619555505");
    expect(rb.status === "hit" && rb.product.id).toBe("0096619555505");
  });

  it("the key is the 13-digit form for 9 to 13 digits; EAN-8 stays as is", async () => {
    const { cacheKey } = await import("./open-food-facts-port.js");
    expect(cacheKey("096619555505")).toBe("0096619555505");
    expect(cacheKey("0096619555505")).toBe("0096619555505");
    expect(cacheKey("96385074")).toBe("96385074");
  });
});

describe("in-flight de-duplication", () => {
  it("two concurrent lookups of one code send one request", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetch, sent } = stubFetch(async () => {
      await gate;
      return replay("full-peanut-butter.json")();
    });
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    const first = port.resolve(PEANUT_BUTTER);
    const second = port.resolve(PEANUT_BUTTER);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(sent).toHaveLength(1);
    expect(a.status).toBe("hit");
    expect(b).toEqual(a);
  });
});

describe("configuration from the environment", () => {
  it("defaults to production and the default User-Agent", () => {
    expect(offConfigFromEnvironment({})).toEqual({
      baseUrl: "https://world.openfoodfacts.org",
      userAgent: OFF_DEFAULT_USER_AGENT,
    });
  });

  it("reads SK_OFF_BASE_URL and SK_OFF_USER_AGENT", () => {
    expect(
      offConfigFromEnvironment({
        SK_OFF_BASE_URL: "https://world.openfoodfacts.net/",
        SK_OFF_USER_AGENT: "  SmartKitchen/0.1 (someone@example.invalid) ",
      }),
    ).toEqual({
      baseUrl: "https://world.openfoodfacts.net",
      userAgent: "SmartKitchen/0.1 (someone@example.invalid)",
    });
  });

  it.each([
    "not a url",
    "http://world.openfoodfacts.org",
    "ftp://world.openfoodfacts.org",
    "https://off:off@world.openfoodfacts.net",
    "https://world.openfoodfacts.org/?x=1",
  ])("refuses the base URL %s", (base) => {
    expect(() => offConfigFromEnvironment({ SK_OFF_BASE_URL: base })).toThrow(
      OffConfigurationError,
    );
  });

  it("refuses a User-Agent with a line break (header injection)", () => {
    expect(() => offConfigFromEnvironment({ SK_OFF_USER_AGENT: "A\r\nX-Evil: 1" })).toThrow(
      OffConfigurationError,
    );
  });
});
