/**
 * Live smoke test against a real Open Food Facts host (M2-T4a, rule 18).
 *
 * **Skipped unless `SK_OFF_LIVE_TEST=1` is set**, so the default suite and CI
 * never open a connection to OFF. When it runs it sends exactly one product
 * read, to OFF's staging host by default (D-025: staging is for manual
 * developer testing), or to `SK_OFF_BASE_URL` when that is set:
 *
 *   SK_OFF_LIVE_TEST=1 pnpm vitest run packages/adapters/src/product-lookup/open-food-facts/open-food-facts.live.test.ts
 *
 * The barcode is the one OFF's own documentation uses as its example
 * (3017620422003), so it exists on both hosts.
 */

import { describe, expect, it } from "vitest";
import { OFF_STAGING_BASE_URL } from "./config.js";
import { OpenFoodFactsProductLookupPort } from "./open-food-facts-port.js";

const LIVE = process.env["SK_OFF_LIVE_TEST"] === "1";

describe.skipIf(!LIVE)("Open Food Facts live smoke (SK_OFF_LIVE_TEST=1 only)", () => {
  it("resolves OFF's documentation example barcode with every field ESTIMATED", async () => {
    const baseUrl = process.env["SK_OFF_BASE_URL"] ?? OFF_STAGING_BASE_URL;
    const userAgent = process.env["SK_OFF_USER_AGENT"];
    const port = new OpenFoodFactsProductLookupPort({
      baseUrl,
      ...(userAgent === undefined || userAgent === "" ? {} : { userAgent }),
    });
    const result = await port.resolve({ codeType: "EAN13", code: "3017620422003" });

    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.name.value.length).toBeGreaterThan(0);
    expect(result.product.name.provenance.tier).toBe("ESTIMATED");
    expect(result.product.name.provenance.source).toBe("open-food-facts");
    expect(result.product.allergens.every((a) => a.provenance.tier === "ESTIMATED")).toBe(true);
  }, 15_000);
});
