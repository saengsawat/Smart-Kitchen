/**
 * Inventory-contracts consistency check (M3-T3).
 *
 * `packages/contracts/src/inventory.ts` hand-writes `TRANSACTION_TYPES_DTO`
 * rather than importing `packages/domain/src/inventory/types.ts`'s
 * `TRANSACTION_TYPES`, for the same reason `household-contracts-consistency
 * .test.ts` hand-writes the allergen code list: contracts must stay
 * dependency-free so `apps/mobile` can depend on it without pulling
 * `@smart-kitchen/domain` into the client bundle (M3-T1 invariant). That
 * leaves the two lists free to drift silently, which is exactly what the
 * ticket asks this suite to close: "a consistency test in packages/adapters
 * proving the DTO transaction type list equals TRANSACTION_TYPES."
 *
 * Lives here, not in `packages/contracts` or `packages/domain`, because
 * `packages/adapters` is the one package allowed to depend on both — same
 * placement reasoning as `household-contracts-consistency.test.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRANSACTION_TYPES, type ProvenanceTier } from "@smart-kitchen/domain";
import {
  API_ERROR_CODES,
  INVENTORY_ITEM_CONFIRM_ROUTE,
  INVENTORY_ITEM_ROUTE,
  LEDGER_ERROR_CODES_DTO,
  TRANSACTION_TYPES_DTO,
  inventoryItemConfirmPath,
  type ProvenanceTierDto,
} from "@smart-kitchen/contracts";

describe("inventory contracts vs domain transaction types", () => {
  it("TRANSACTION_TYPES_DTO equals the domain's TRANSACTION_TYPES, in the same order", () => {
    expect(TRANSACTION_TYPES_DTO).toEqual(TRANSACTION_TYPES);
  });

  it("neither list has a member the other lacks", () => {
    expect(new Set(TRANSACTION_TYPES_DTO)).toEqual(new Set(TRANSACTION_TYPES));
  });
});

/**
 * M2-T5 (D-028): confirming an AI proposal.
 *
 * 1. **Path.** The client's path helper must produce a URL the server's route
 *    pattern matches, with the item id in the parameter's place and encoded.
 * 2. **The new error code.** `NOT_A_PROPOSAL` is the API's own refusal, an
 *    `ApiErrorCode`, never a ledger code: the ledger is not consulted.
 * 3. **The tiers a confirmation joins.** The read presents a confirmed
 *    `AI_INTERPRETATION` row as `KNOWN_FACT`; the wire tier union and the
 *    domain's must be the same set, checked at compile time both ways.
 * 4. **The key shape.** Migration 0010's CHECK on `client_key` must be the
 *    same pattern as the M2-T2 key shape migration 0009 already pins, so a key
 *    the write path accepts is never refused by the confirmations table and
 *    the other way round. Read from the committed SQL with `node:fs`; this
 *    package does not depend on `apps/api`.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(
  moduleDir,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "api",
  "db",
  "migrations",
);

/** The route pattern as a regex, `:itemId` standing for one encoded path segment. */
function routeMatcher(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(":itemId", "([^/]+)");
  return new RegExp(`^${escaped}$`);
}

describe("confirm an AI proposal (M2-T5)", () => {
  it("the client path matches the server route with the item id in place", () => {
    const itemId = "0190f0a0-0000-7000-8000-000000000001";
    const match = routeMatcher(INVENTORY_ITEM_CONFIRM_ROUTE).exec(inventoryItemConfirmPath(itemId));
    expect(match?.[1]).toBe(itemId);
    expect(INVENTORY_ITEM_CONFIRM_ROUTE.startsWith(`${INVENTORY_ITEM_ROUTE}/`)).toBe(true);
  });

  it("a hostile item id stays inside its segment", () => {
    const hostile = "../../shopping/rows";
    const match = routeMatcher(INVENTORY_ITEM_CONFIRM_ROUTE).exec(
      inventoryItemConfirmPath(hostile),
    );
    expect(match?.[1]).toBe(encodeURIComponent(hostile));
  });

  it("NOT_A_PROPOSAL is an API error code and not a ledger code", () => {
    expect(API_ERROR_CODES).toContain("NOT_A_PROPOSAL");
    expect(LEDGER_ERROR_CODES_DTO as readonly string[]).not.toContain("NOT_A_PROPOSAL");
  });

  it("the wire's tier union and the domain's are the same set (compile-time, both directions)", () => {
    const toWire = (tier: ProvenanceTier): ProvenanceTierDto => tier;
    const toDomain = (tier: ProvenanceTierDto): ProvenanceTier => tier;
    expect(toWire("AI_INTERPRETATION")).toBe("AI_INTERPRETATION");
    expect(toDomain("KNOWN_FACT")).toBe("KNOWN_FACT");
  });

  it("migration 0010's client_key CHECK is the same key shape migration 0009 pins", () => {
    const read = (file: string): string => readFileSync(path.join(migrationsDir, file), "utf8");
    const confirmations = /client_key\s+text NOT NULL CHECK \(client_key ~ '([^']+)'\)/.exec(
      read("0010_inventory_confirmations.sql"),
    );
    const shopping = /idempotency_key\s+text NOT NULL CHECK \(idempotency_key ~ '([^']+)'\)/.exec(
      read("0009_shopping_rows.sql"),
    );
    expect(confirmations?.[1]).toBe("^[A-Za-z0-9._-]{1,128}$");
    expect(confirmations?.[1]).toBe(shopping?.[1]);
  });
});
