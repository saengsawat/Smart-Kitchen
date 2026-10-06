/**
 * M2-T4c (d): a GTIN14 reaching a lookup port directly is normalised to its
 * EAN-13 key (indicator 0) or refused (any other indicator), so one product
 * never keys twice. Both ports are covered; nothing opens a connection.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FixtureProductLookupPort } from "./fixture-product-lookup-port.js";
import { OFF_FIXTURES_DIR } from "./fixture-paths.js";
import { OpenFoodFactsProductLookupPort, type FetchLike } from "./open-food-facts/index.js";
import { gs1CheckDigit, isLookupCodeRefusal, normalizeLookupCode } from "./schema.js";
import type { ProductCode } from "./types.js";

/** A valid GTIN14 for `indicator` over a 12-digit EAN-13 body. */
function gtin14(indicator: string, body12: string): string {
  const body = `${indicator}${body12}`;
  return `${body}${String(gs1CheckDigit(body))}`;
}

function offStub(): { fetch: FetchLike; sent: string[] } {
  const raw = JSON.parse(
    readFileSync(path.join(OFF_FIXTURES_DIR, "full-peanut-butter.json"), "utf8"),
  ) as { capture: { httpStatus: number }; body: unknown };
  const sent: string[] = [];
  const fetch: FetchLike = (url) => {
    sent.push(url);
    return Promise.resolve({
      status: raw.capture.httpStatus,
      text: () => Promise.resolve(JSON.stringify(raw.body)),
    });
  };
  return { fetch, sent };
}

describe("normalizeLookupCode", () => {
  it("passes every non-GTIN14 code through untouched", () => {
    const code: ProductCode = { codeType: "UPC_A", code: "096619555505" };
    expect(normalizeLookupCode(code)).toBe(code);
  });

  it("indicator 0 becomes the EAN-13 in its last 13 digits", () => {
    expect(normalizeLookupCode({ codeType: "GTIN14", code: "00096619555505" })).toEqual({
      codeType: "EAN13",
      code: "0096619555505",
    });
  });

  it("indicator 1 to 9 is a refusal", () => {
    for (const indicator of "123456789") {
      const result = normalizeLookupCode({
        codeType: "GTIN14",
        code: gtin14(indicator, "009661955550"),
      });
      expect(isLookupCodeRefusal(result), indicator).toBe(true);
    }
  });
});

describe("FixtureProductLookupPort, GTIN14", () => {
  const port = new FixtureProductLookupPort();

  it("indicator 0 resolves to the same product as its EAN-13, answered under the EAN-13 key", async () => {
    const viaEan13 = await port.resolve({ codeType: "EAN13", code: "4800009000003" });
    const viaGtin14 = await port.resolve({ codeType: "GTIN14", code: "04800009000003" });
    expect(viaEan13.status).toBe("hit");
    expect(viaGtin14.status).toBe("hit");
    if (viaEan13.status !== "hit" || viaGtin14.status !== "hit") return;
    expect(viaGtin14.product.id).toBe(viaEan13.product.id);
    expect(viaGtin14.code).toEqual({ codeType: "EAN13", code: "4800009000003" });
  });

  it("indicator 1 to 9 is INVALID_CODE even with a valid check digit", async () => {
    for (const indicator of "123456789") {
      const code = gtin14(indicator, "480000900000");
      const result = await port.resolve({ codeType: "GTIN14", code });
      expect(result.status, code).toBe("error");
      if (result.status === "error") expect(result.error.code).toBe("INVALID_CODE");
    }
  });
});

describe("OpenFoodFactsProductLookupPort, GTIN14", () => {
  it("indicator 0 is looked up as its EAN-13 and shares that code's one cache entry", async () => {
    const { fetch, sent } = offStub();
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    await port.resolve({ codeType: "EAN13", code: "0096619555505" });
    const viaGtin14 = await port.resolve({ codeType: "GTIN14", code: "00096619555505" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("/api/v2/product/0096619555505.json");
    expect(viaGtin14.code).toEqual({ codeType: "EAN13", code: "0096619555505" });
    expect(viaGtin14.status).toBe("hit");
    if (viaGtin14.status === "hit") {
      expect(viaGtin14.product.codes).toEqual([{ codeType: "EAN13", code: "0096619555505" }]);
    }
  });

  it("indicator 1 to 9 is INVALID_CODE and nothing is sent", async () => {
    const { fetch, sent } = offStub();
    const port = new OpenFoodFactsProductLookupPort({ fetch });
    for (const indicator of "123456789") {
      const result = await port.resolve({
        codeType: "GTIN14",
        code: gtin14(indicator, "009661955550"),
      });
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error.code).toBe("INVALID_CODE");
    }
    expect(sent).toHaveLength(0);
  });
});
