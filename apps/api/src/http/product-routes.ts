/**
 * `GET /v1/products/{code}` (M2-T4a (c), D-025).
 *
 * | Answer | When |
 * | --- | --- |
 * | 200 `hit` | the source knows the code; `screening` is `NOT_RUN` until M2-T4 |
 * | 200 `not-found` | the source answered that it does not know the code |
 * | 200 `error` | the source could not answer (429, 5xx, timeout, network, unreadable), never folded into `not-found` |
 * | 400 `PLU_NOT_SUPPORTED` | a 4 or 5 digit produce code; nothing is sent anywhere (ADR-006) |
 * | 400 `BAD_REQUEST` | not a barcode: wrong length, a bad check digit, not digits |
 * | 401 / 403 | no session, or a signed-in caller with no household (`householdRoute`) |
 *
 * Optional query `type` (M2-T4c): the symbology the camera read, one of
 * `upc_a`, `upc_e`, `ean13`, `ean8`. When present the code is parsed as that
 * symbology only (`upc_e` looks up its expanded UPC-A); when absent the code
 * is parsed by its shape, as before. An unknown `type` is a 400 `BAD_REQUEST`.
 *
 * Any member may look a product up. The route reads nothing from the
 * database: there is no product table (D-025 (3)), and no household state
 * is involved until M2-T4 runs screening here.
 *
 * Logging: one line per lookup with the code, the outcome and, on `error`,
 * the adapter's error code. The code is a product identifier, not personal
 * data; the source's response body is never logged.
 */

import {
  asScannableBarcodeType,
  PRODUCT_LOOKUP_ROUTE,
  type ApiErrorBodyDto,
  type ApiErrorCode,
  type ProductLookupResultDto,
} from "@smart-kitchen/contracts";
import type { ProductLookupPort } from "@smart-kitchen/adapters";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  lookupProductForSession,
  notRunScreening,
  parseLookupCode,
  type ProductScreeningStep,
} from "../products/lookup-service.js";
import { householdRoute, requireSession } from "./authorization.js";

export interface ProductRouteDeps {
  readonly lookup: ProductLookupPort;
  /** Defaults to {@link notRunScreening}; M2-T4 supplies the engine-backed step. */
  readonly screening?: ProductScreeningStep;
}

export const PLU_NOT_SUPPORTED_MESSAGE =
  "Produce codes can't be looked up by barcode yet. Add this item by hand.";

export const NOT_A_BARCODE_MESSAGE = "That isn't a barcode number we can look up.";

async function refuse(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ApiErrorCode,
  message: string,
): Promise<undefined> {
  const body: ApiErrorBodyDto = { error: { code, message, correlationId: request.id } };
  await reply.code(400).send(body);
  return undefined;
}

export function registerProductRoutes(app: FastifyInstance, deps: ProductRouteDeps): void {
  const screening = deps.screening ?? notRunScreening;

  app.get(
    PRODUCT_LOOKUP_ROUTE,
    { config: { authorization: householdRoute() } },
    async (request, reply): Promise<ProductLookupResultDto | undefined> => {
      const session = requireSession(request);
      const { code: raw } = request.params as { code: string };
      const routePath = request.routeOptions.url ?? "(no route)";
      // M2-T4c: the optional symbology hint. Present but not one of the
      // scannable types (or repeated): refused like any other invalid code.
      const { type: rawType } = request.query as { type?: unknown };
      const type = asScannableBarcodeType(rawType);
      const parsed =
        rawType !== undefined && type === undefined
          ? ({ kind: "invalid" } as const)
          : parseLookupCode(raw, type);

      if (parsed.kind === "plu") {
        request.log.info({ routePath, productCode: raw, outcome: "plu-refused" }, "product.lookup");
        return refuse(request, reply, "PLU_NOT_SUPPORTED", PLU_NOT_SUPPORTED_MESSAGE);
      }
      if (parsed.kind === "invalid") {
        // Not logged as a code: whatever the caller typed is not known to be one.
        request.log.info({ routePath, outcome: "invalid-code" }, "product.lookup");
        return refuse(request, reply, "BAD_REQUEST", NOT_A_BARCODE_MESSAGE);
      }

      const result = await lookupProductForSession(
        deps.lookup,
        screening,
        parsed.code,
        raw,
        session,
      );
      request.log.info(
        {
          routePath,
          productCode: raw,
          outcome: result.body.status,
          ...(result.errorCode === undefined ? {} : { lookupError: result.errorCode }),
        },
        "product.lookup",
      );
      return result.body;
    },
  );
}
