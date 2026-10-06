/**
 * `GET /v1/products/{code}` over HTTP (M2-T4a (c)), without a database: the
 * route reads no table, so the whole matrix runs on every machine.
 *
 * The lookup port is the real `OpenFoodFactsProductLookupPort` with a stub
 * `fetch` that replays the responses recorded in `tests/fixtures/off/` (or
 * simulates a failure). Nothing here opens a network connection.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  OpenFoodFactsProductLookupPort,
  type FetchLike,
  type ProductLookupPort,
} from "@smart-kitchen/adapters";
import {
  productLookupPath,
  type ApiErrorBodyDto,
  type ProductLookupResultDto,
  type ScannableBarcodeTypeDto,
  type ScreeningOutcomeDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { TenantSessionRunner } from "../http/tenant-session.js";
import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  REPO_ROOT,
  type FixtureIdentityData,
  type Session,
} from "../identity/index.js";
import { LOOKUP_ERROR_MESSAGE, type ProductScreeningStep } from "./lookup-service.js";

const DEAN = "fixture.dean.chen";
const MAYA = "fixture.maya.chen";
const ADA = "fixture.owner.other";
const NEW = "fixture.new.user";

const PEANUT_BUTTER = "096619555505";
const MISSING = "481293740567";

interface Recorded {
  readonly capture: { readonly httpStatus: number };
  readonly body: unknown;
}

function recorded(file: string): { status: number; body: string } {
  const parsed = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "off", file), "utf8"),
  ) as Recorded;
  return { status: parsed.capture.httpStatus, body: JSON.stringify(parsed.body) };
}

/** Replays a recording per code; anything else is OFF's miss for that code. */
function replayingFetch(): { fetch: FetchLike; sent: string[] } {
  const byCode: Record<string, string> = {
    [PEANUT_BUTTER]: "full-peanut-butter.json",
    "0096619555505": "full-peanut-butter.json",
    [MISSING]: "not-found.json",
    "044000004637": "upc-e-graham-crackers.json",
    "0044000004637": "upc-e-graham-crackers.json",
    "5285000396437": "english-name-only-indomie.json",
  };
  const sent: string[] = [];
  const fetch: FetchLike = (url) => {
    sent.push(url);
    const code = /product\/(\d+)\.json/.exec(url)?.[1] ?? "";
    const file = byCode[code];
    const answer = file
      ? recorded(file)
      : {
          status: 404,
          body: JSON.stringify({ code, status: 0, status_verbose: "product not found" }),
        };
    return Promise.resolve({ status: answer.status, text: () => Promise.resolve(answer.body) });
  };
  return { fetch, sent };
}

let identityData: FixtureIdentityData;

beforeAll(async () => {
  identityData = await loadFixtureIdentityData();
});

const open: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

interface Harness {
  readonly app: FastifyInstance;
  readonly logLines: string[];
  readonly scoped: Session[];
}

function harness(lookup: ProductLookupPort, screening?: ProductScreeningStep): Harness {
  const logLines: string[] = [];
  const scoped: Session[] = [];
  const refuse = <T>(session: Session): Promise<T> => {
    scoped.push(session);
    return Promise.reject(new Error("the product route must not open a tenant session"));
  };
  const tenantSession: TenantSessionRunner = { read: refuse, write: refuse };
  const app = buildApp({
    identity: createFixtureIdentityPort(identityData),
    tenantSession,
    products: { lookup, ...(screening === undefined ? {} : { screening }) },
    logging: {
      level: "info",
      destination: {
        write(line: string): void {
          logLines.push(line);
        },
      },
    },
  });
  open.push(app);
  return { app, logLines, scoped };
}

async function get<T>(
  app: FastifyInstance,
  code: string,
  token: string | undefined,
  type?: ScannableBarcodeTypeDto,
): Promise<{ statusCode: number; body: T }> {
  const response = await app.inject({
    method: "GET",
    url: productLookupPath(code, type),
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { statusCode: response.statusCode, body: response.json<T>() };
}

describe("HTTP matrix across the four fixture tokens", () => {
  it("every household member gets the product; a caller with no household is 403; no or unknown token is 401", async () => {
    const { fetch } = replayingFetch();
    const { app, scoped } = harness(new OpenFoodFactsProductLookupPort({ fetch }));

    for (const token of [DEAN, MAYA, ADA]) {
      const answer = await get<ProductLookupResultDto>(app, PEANUT_BUTTER, token);
      expect(answer.statusCode, token).toBe(200);
      expect(answer.body.status, token).toBe("hit");
    }
    const newcomer = await get<ApiErrorBodyDto>(app, PEANUT_BUTTER, NEW);
    expect(newcomer.statusCode).toBe(403);
    expect(newcomer.body.error.code).toBe("FORBIDDEN");

    for (const token of [undefined, "fixture.nobody"]) {
      const denied = await get<ApiErrorBodyDto>(app, PEANUT_BUTTER, token);
      expect(denied.statusCode, String(token)).toBe(401);
      expect(denied.body.error.code).toBe("UNAUTHENTICATED");
    }
    expect(scoped).toEqual([]);
  });
});

describe("response shape", () => {
  it("a hit is a ScannedProductDto: identity by code, every label field ESTIMATED from OFF, screening NOT_RUN", async () => {
    const { fetch } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const { statusCode, body } = await get<ProductLookupResultDto>(app, PEANUT_BUTTER, DEAN);

    expect(statusCode).toBe(200);
    expect(body.status).toBe("hit");
    if (body.status !== "hit") return;
    expect(body.code).toBe(PEANUT_BUTTER);
    const product = body.product;
    expect(Object.keys(product).sort()).toEqual(
      [
        "bestBy",
        "brand",
        "codes",
        "ingredientsText",
        "name",
        "nutrition",
        "packageSize",
        "productId",
        "screening",
      ].sort(),
    );
    expect(product.productId).toBe(PEANUT_BUTTER);
    expect(product.codes).toEqual([{ codeType: "UPC_A", code: PEANUT_BUTTER }]);
    expect(product.name.value).toBe("Organic Creamy Peanut Butter");
    expect(product.packageSize?.value).toEqual({ qty: "793.8", unit: "g" });
    expect(product.bestBy).toBeNull();
    expect(product.screening).toEqual({
      status: "NOT_RUN",
      reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED",
    });

    const provenances = [
      product.name.provenance,
      product.brand?.provenance,
      product.packageSize?.provenance,
      product.ingredientsText?.provenance,
      ...product.nutrition.map((n) => n.provenance),
    ];
    for (const p of provenances) {
      expect(p).toEqual({
        tier: "ESTIMATED",
        source: "open-food-facts",
        confidence: null,
        recordedAt: "2026-09-29T13:02:12.000Z", // last_modified_t 1790686932
      });
    }
    // Nothing on the wire claims Known Fact: the identity chip on S8 is the code match itself.
    expect(JSON.stringify(body)).not.toContain("KNOWN_FACT");
  });

  it("an unknown code is not-found with the code kept", async () => {
    const { fetch } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const { statusCode, body } = await get<ProductLookupResultDto>(app, MISSING, MAYA);
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: "not-found", code: MISSING });
  });

  it("the screening step is where M2-T4 plugs in: whatever it decides is what the response carries", async () => {
    const { fetch } = replayingFetch();
    const seen: string[] = [];
    const ran: ScreeningOutcomeDto = {
      status: "RUN",
      result: {
        subjectKind: "PRODUCT",
        subjectId: PEANUT_BUTTER,
        verdict: "BLOCKED",
        members: [],
        evidence: [],
        unknowns: [],
        warnings: [],
      },
    };
    const step: ProductScreeningStep = {
      screen: (product, session) => {
        seen.push(`${product.id}:${session.householdId}`);
        return Promise.resolve(ran);
      },
    };
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }), step);
    const { body } = await get<ProductLookupResultDto>(app, PEANUT_BUTTER, DEAN);
    expect(body.status === "hit" && body.product.screening).toEqual(ran);
    expect(seen).toEqual([`${PEANUT_BUTTER}:f1c70000-0000-4000-8000-000000000001`]);
  });
});

describe("source failures are error, never not-found", () => {
  it("a 429 from OFF answers error", async () => {
    const fetch: FetchLike = () =>
      Promise.resolve({ status: 429, text: () => Promise.resolve("Too Many Requests") });
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const { statusCode, body } = await get<ProductLookupResultDto>(app, PEANUT_BUTTER, DEAN);
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: "error", code: PEANUT_BUTTER, message: LOOKUP_ERROR_MESSAGE });
  });

  it("a timeout answers error", async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const { app, logLines } = harness(new OpenFoodFactsProductLookupPort({ fetch, timeoutMs: 20 }));
    const { body } = await get<ProductLookupResultDto>(app, PEANUT_BUTTER, DEAN);
    expect(body).toEqual({ status: "error", code: PEANUT_BUTTER, message: LOOKUP_ERROR_MESSAGE });
    expect(logLines.join("\n")).toContain('"lookupError":"UPSTREAM_TIMEOUT"');
  });

  it("a 500 and a network failure answer error", async () => {
    for (const fetch of [
      (() => Promise.resolve({ status: 500, text: () => Promise.resolve("oops") })) as FetchLike,
      (() => Promise.reject(new TypeError("fetch failed"))) as FetchLike,
    ]) {
      const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
      const { body } = await get<ProductLookupResultDto>(app, PEANUT_BUTTER, DEAN);
      expect(body.status).toBe("error");
    }
  });
});

describe("codes that never reach the source", () => {
  it.each(["4011", "94011", "3082"])(
    "PLU %s is 400 PLU_NOT_SUPPORTED and nothing is sent",
    async (plu) => {
      const { fetch, sent } = replayingFetch();
      const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
      const { statusCode, body } = await get<ApiErrorBodyDto>(app, plu, DEAN);
      expect(statusCode).toBe(400);
      expect(body.error.code).toBe("PLU_NOT_SUPPORTED");
      expect(sent).toEqual([]);
    },
  );

  it.each([
    ["letters", "abc"],
    ["too short", "123"],
    ["an odd length", "123456789"],
    ["a bad check digit", "096619555504"],
    ["15 digits", "000096619555505"],
    ["a case-level GTIN-14", "10096619555502"],
    ["a sign", "-96619555505"],
  ])("%s is 400 BAD_REQUEST and nothing is sent", async (_label, code) => {
    const { fetch, sent } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const { statusCode, body } = await get<ApiErrorBodyDto>(app, code, DEAN);
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(sent).toEqual([]);
  });

  it("a GTIN-14 with indicator 0 is looked up as its EAN-13, and the response echoes the code asked", async () => {
    const { fetch, sent } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const { body } = await get<ProductLookupResultDto>(app, "00096619555505", DEAN);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("/api/v2/product/0096619555505.json");
    expect(body.status).toBe("hit");
    expect(body.code).toBe("00096619555505");
  });

  it("M2-T4b (a): a recorded UPC-E and its UPC-A form resolve to the same product, and only the UPC-A is sent", async () => {
    const { fetch, sent } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const e = await get<ProductLookupResultDto>(app, "04446307", DEAN);
    const a = await get<ProductLookupResultDto>(app, "044000004637", DEAN);
    expect(e.statusCode).toBe(200);
    expect(e.body.status).toBe("hit");
    expect(a.body.status).toBe("hit");
    if (e.body.status !== "hit" || a.body.status !== "hit") return;
    expect(e.body.code).toBe("04446307"); // the echo is what was asked
    expect(e.body.product.name.value).toBe("Honey Maid Graham Crackers");
    expect(e.body.product.name).toEqual(a.body.product.name);
    expect(e.body.product.packageSize).toEqual(a.body.product.packageSize);
    expect(e.body.product.codes).toEqual([{ codeType: "UPC_A", code: "044000004637" }]);
    expect(sent).toHaveLength(1); // one shared cache entry
    expect(sent[0]).toContain("/api/v2/product/044000004637.json");
    expect(sent[0]).not.toContain("04446307");
  });

  it("M2-T4b (a): an 8-digit code that is neither an EAN-8 nor a UPC-E with a valid check digit is 400 and nothing is sent", async () => {
    const { fetch, sent } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    for (const code of ["04446308", "24446307"]) {
      const { statusCode, body } = await get<ApiErrorBodyDto>(app, code, DEAN);
      expect(statusCode, code).toBe(400);
      expect(body.error.code, code).toBe("BAD_REQUEST");
    }
    expect(sent).toEqual([]);
  });

  it("M2-T4b (c): a record with only product_name_en is a hit", async () => {
    const { fetch } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const { statusCode, body } = await get<ProductLookupResultDto>(app, "5285000396437", DEAN);
    expect(statusCode).toBe(200);
    expect(body.status).toBe("hit");
    if (body.status === "hit") expect(body.product.name.value).toBe("Indomie");
  });

  it("M2-T4b (b): indicator 1 to 9 GTIN-14s stay 400 and indicator 0 stays a hit", async () => {
    const { fetch, sent } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    // Valid check digits, so only the indicator decides.
    for (const code of ["10096619555502", "20096619555509", "90096619555508"]) {
      const { statusCode } = await get<ApiErrorBodyDto>(app, code, DEAN);
      expect(statusCode, code).toBe(400);
    }
    expect(sent).toEqual([]);
    const ok = await get<ProductLookupResultDto>(app, "00044000004637", DEAN);
    expect(ok.body.status).toBe("hit");
  });

  it("an 8 and a 13 digit code are accepted", async () => {
    const { fetch, sent } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    expect((await get<ProductLookupResultDto>(app, "96385074", DEAN)).statusCode).toBe(200);
    expect((await get<ProductLookupResultDto>(app, "3017620422003", DEAN)).statusCode).toBe(200);
    expect(sent).toHaveLength(2);
  });
});

describe("M2-T4c: the symbology hint (type)", () => {
  async function sentFor(
    code: string,
    type: string | undefined,
  ): Promise<{ statusCode: number; sent: string[]; log: string }> {
    const { fetch, sent } = replayingFetch();
    const { app, logLines } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const response = await app.inject({
      method: "GET",
      url: `/v1/products/${code}${type === undefined ? "" : `?type=${type}`}`,
      headers: { authorization: `Bearer ${DEAN}` },
    });
    return { statusCode: response.statusCode, sent, log: logLines.join("\n") };
  }

  it.each([
    ["upc_a", "096619555505", "/api/v2/product/096619555505.json"],
    ["ean13", "3017620422003", "/api/v2/product/3017620422003.json"],
    ["ean8", "96385074", "/api/v2/product/96385074.json"],
    ["upc_e", "04446307", "/api/v2/product/044000004637.json"],
  ])("%s with a matching code is looked up as that symbology", async (type, code, path) => {
    const { statusCode, sent } = await sentFor(code, type);
    expect(statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(path);
  });

  it.each([["096619555505"], ["3017620422003"], ["96385074"], ["04446307"]])(
    "%s without a type is looked up exactly as before",
    async (code) => {
      const { statusCode, sent } = await sentFor(code, undefined);
      expect(statusCode).toBe(200);
      expect(sent).toHaveLength(1);
    },
  );

  it.each([
    ["upc_a", "096619555504"],
    ["ean13", "3017620422004"],
    ["ean8", "96385075"],
    ["upc_e", "04446308"],
  ])(
    "%s with a check digit mismatch is 400, nothing is sent and the code is not logged",
    async (type, code) => {
      const { statusCode, sent, log } = await sentFor(code, type);
      expect(statusCode).toBe(400);
      expect(sent).toEqual([]);
      expect(log).toContain('"outcome":"invalid-code"');
      expect(log).not.toContain(code);
    },
  );

  it.each([
    ["upc_a", "96385074"], // a valid EAN-8 is not a UPC-A
    ["ean13", "096619555505"], // a valid UPC-A is not an EAN-13
    ["ean8", "096619555505"],
    ["upc_e", "096619555505"],
    ["upc_e", "24446307"], // number system 2
  ])("%s with a code of the wrong length or shape is 400", async (type, code) => {
    const { statusCode, sent } = await sentFor(code, type);
    expect(statusCode).toBe(400);
    expect(sent).toEqual([]);
  });

  it.each(["code128", "UPC_A", "", "upc_a,ean8"])(
    "an unknown type %j is 400 BAD_REQUEST and nothing is sent",
    async (type) => {
      const { fetch, sent } = replayingFetch();
      const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
      const response = await app.inject({
        method: "GET",
        url: `/v1/products/096619555505?type=${encodeURIComponent(type)}`,
        headers: { authorization: `Bearer ${DEAN}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ApiErrorBodyDto>().error.code).toBe("BAD_REQUEST");
      expect(sent).toEqual([]);
    },
  );

  it("a repeated type parameter is 400", async () => {
    const { fetch, sent } = replayingFetch();
    const { app } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/products/096619555505?type=upc_a&type=upc_a",
      headers: { authorization: `Bearer ${DEAN}` },
    });
    expect(response.statusCode).toBe(400);
    expect(sent).toEqual([]);
  });

  it("a code valid as both EAN-8 and UPC-E: type=upc_e looks up the UPC-A, type=ean8 the EAN-8, no type reads by first digit", async () => {
    // 04016007: UPC-E first without a hint (leading 0).
    const asE = await sentFor("04016007", "upc_e");
    expect(asE.sent).toHaveLength(1);
    expect(asE.sent[0]).toContain("/api/v2/product/040000001607.json");
    const asEan8 = await sentFor("04016007", "ean8");
    expect(asEan8.sent[0]).toContain("/api/v2/product/04016007.json");
    const noHint = await sentFor("04016007", undefined);
    expect(noHint.sent[0]).toContain("/api/v2/product/040000001607.json");
    // 12345670: EAN-8 first without a hint (leading 1); the hint can still pick UPC-E.
    const oneE = await sentFor("12345670", "upc_e");
    expect(oneE.sent[0]).toContain("/api/v2/product/123456000070.json");
    const oneNone = await sentFor("12345670", undefined);
    expect(oneNone.sent[0]).toContain("/api/v2/product/12345670.json");
  });

  it("11234502 without a type is the leading-1 UPC-E fallback: UPC-A 112000003452", async () => {
    const { statusCode, sent } = await sentFor("11234502", undefined);
    expect(statusCode).toBe(200);
    expect(sent[0]).toContain("/api/v2/product/112000003452.json");
  });
});

describe("logging", () => {
  it("logs the code and the outcome, never the response body or the token", async () => {
    const { fetch } = replayingFetch();
    const { app, logLines } = harness(new OpenFoodFactsProductLookupPort({ fetch }));
    await get<ProductLookupResultDto>(app, PEANUT_BUTTER, DEAN);
    const lookupLines = logLines.filter((line) => line.includes('"product.lookup"'));
    expect(lookupLines).toHaveLength(1);
    expect(lookupLines[0]).toContain(`"productCode":"${PEANUT_BUTTER}"`);
    expect(lookupLines[0]).toContain('"outcome":"hit"');
    const all = logLines.join("\n");
    expect(all).not.toContain("Dry roasted organic peanuts");
    expect(all).not.toContain("Organic Creamy Peanut Butter");
    expect(all).not.toContain(DEAN);
  });
});
