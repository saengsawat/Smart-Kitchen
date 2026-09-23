/**
 * The Chen household's fixture inventory (M3-T3), reproducing prototype v4's
 * `#scr-inventory` rows and `#scr-item`'s chicken-breast ledger exactly
 * (docs/design/mockups/smart-kitchen-prototype.html lines 610-661, 1104-1132).
 *
 * Built fresh per `FixtureApiClient` instance (`buildChenInventory()` is a
 * factory, not a shared singleton) so one test's writes never leak into
 * another's, and so `FixtureApiClient.newUser()` vs `.returningUser()` each
 * get their own independent, in-memory, append-only ledger (CLAUDE.md rule
 * 10; `src/inventory/ledger.ts` is the module that enforces append-only).
 */

import type {
  InventoryLotDto,
  StorageLocationDto,
  TransactionActorDto,
} from "@smart-kitchen/contracts";
import { appendDecrease, appendIncrease, type MutableItemFixture } from "./ledger";

/** Fixed "now" so the fixture's expiry countdowns are deterministic in tests, not wall-clock dependent. */
export const FIXTURE_NOW = "2026-09-22T12:00:00.000Z";

const DEAN: TransactionActorDto = { kind: "user", displayInitials: "DC" };

function daysFromNow(days: number): string {
  return new Date(new Date(FIXTURE_NOW).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function lot(params: {
  lotId: string;
  label?: string | null;
  acquiredAt?: string | null;
  expiresDays?: number | null;
  amount: string;
  amountMicros: string;
  unit: string;
  tier?: "KNOWN_FACT" | "ESTIMATED";
}): InventoryLotDto {
  return {
    lotId: params.lotId,
    label: params.label ?? null,
    acquiredAt: params.acquiredAt ?? null,
    expiresAt:
      params.expiresDays === undefined || params.expiresDays === null
        ? null
        : daysFromNow(params.expiresDays),
    quantity: { unit: params.unit, micros: params.amountMicros, amount: params.amount },
    expiresAtProvenance:
      params.expiresDays === undefined || params.expiresDays === null
        ? null
        : { tier: params.tier ?? "KNOWN_FACT", source: null, confidence: null, recordedAt: null },
  };
}

function baseItem(params: {
  itemId: string;
  displayName: string;
  storageLocation: StorageLocationDto;
  unit: string;
  lots: readonly InventoryLotDto[];
  initialMicros: bigint;
  tier: "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";
  needsConfirmWhenUnconfirmed: boolean;
  /**
   * The item's initial-stock provenance source: an AI-tier row's tray
   * caption (prototype: "receipt read ..."), or, for every other row, a
   * plain, plausible origin ("scanned barcode", "manual entry", …). Required
   * (review F11): a code-internal token like "fixture-seed" must never
   * render as if it were real provenance text in a history caption or the
   * "why" line.
   */
  source: string;
}): MutableItemFixture {
  const item: MutableItemFixture = {
    itemId: params.itemId,
    displayName: params.displayName,
    storageLocation: params.storageLocation,
    unit: params.unit,
    lots: params.lots,
    history: [],
    confirmed: false,
    needsConfirmWhenUnconfirmed: params.needsConfirmWhenUnconfirmed,
  };
  appendIncrease(item, {
    type: "INITIAL_STOCK",
    amountMicros: params.initialMicros,
    recordedAt: daysFromNow(-30),
    actor: { kind: "system" },
    provenance: {
      tier: params.tier,
      source: params.source,
      confidence: null,
      recordedAt: null,
    },
  });
  return item;
}

/** Chicken breast: the one item whose full ledger history is the ticket's worked example. */
function buildChickenBreast(): MutableItemFixture {
  const item: MutableItemFixture = {
    itemId: "fixture-item-chicken",
    displayName: "Chicken breast",
    storageLocation: "FRIDGE",
    unit: "lb",
    lots: [
      lot({
        lotId: "fixture-item-chicken-lot-2",
        label: "bought Sat",
        acquiredAt: daysFromNow(-3),
        expiresDays: 2,
        amount: "1.250000",
        amountMicros: "1250000",
        unit: "lb",
      }),
    ],
    history: [],
    confirmed: false,
    needsConfirmWhenUnconfirmed: false,
  };

  // Wed: purchased 2.0 lb, scanned barcode.
  appendIncrease(item, {
    type: "PURCHASE",
    amountMicros: 2_000_000n,
    recordedAt: "2026-09-16T18:04:00.000Z",
    actor: DEAN,
    provenance: {
      tier: "KNOWN_FACT",
      source: "scanned barcode",
      confidence: null,
      recordedAt: null,
    },
  });
  // Thu: 2.25 lb recorded used for the stir-fry, more than was on hand (2.0 lb) -> clamps,
  // appending the system ADJUSTMENT for the 0.25 lb residual.
  appendDecrease(item, {
    type: "USE_IN_MEAL",
    magnitudeMicros: 2_250_000n,
    recordedAt: "2026-09-17T19:20:00.000Z",
    actor: DEAN,
    provenance: {
      tier: "KNOWN_FACT",
      source: "cook confirm, FEFO plan",
      confidence: null,
      recordedAt: null,
    },
    reason: null,
    correlationLabel: "Chicken & spinach stir-fry",
  });
  // Sat: purchased another 1.25 lb, scanned barcode.
  appendIncrease(item, {
    type: "PURCHASE",
    amountMicros: 1_250_000n,
    recordedAt: "2026-09-19T17:40:00.000Z",
    actor: DEAN,
    provenance: {
      tier: "KNOWN_FACT",
      source: "scanned barcode",
      confidence: null,
      recordedAt: null,
    },
  });
  // Net: 2.0 - 2.25 + 0.25 + 1.25 = 1.25 lb (BACKLOG.md M3-T3 acceptance criterion).
  return item;
}

/** Builds a fresh copy of the Chen household's fixture inventory. Call once per `FixtureApiClient` instance. */
export function buildChenInventory(): Map<string, MutableItemFixture> {
  const items: MutableItemFixture[] = [
    baseItem({
      itemId: "fixture-item-strawberries",
      displayName: "Strawberries",
      storageLocation: "FRIDGE",
      unit: "lb",
      lots: [
        lot({
          lotId: "fixture-item-strawberries-lot-1",
          expiresDays: 1,
          amount: "1.000000",
          amountMicros: "1000000",
          unit: "lb",
          tier: "ESTIMATED",
        }),
      ],
      initialMicros: 1_000_000n,
      tier: "AI_INTERPRETATION",
      needsConfirmWhenUnconfirmed: true,
      source: "receipt read “ORG STRWB 1LB”",
    }),
    buildChickenBreast(),
    baseItem({
      itemId: "fixture-item-spinach",
      displayName: "Spinach",
      storageLocation: "FRIDGE",
      unit: "oz",
      lots: [
        lot({
          lotId: "fixture-item-spinach-lot-1",
          expiresDays: 3,
          amount: "5.000000",
          amountMicros: "5000000",
          unit: "oz",
        }),
      ],
      initialMicros: 5_000_000n,
      tier: "KNOWN_FACT",
      needsConfirmWhenUnconfirmed: false,
      source: "scanned barcode",
    }),
    baseItem({
      itemId: "fixture-item-mushrooms",
      displayName: "Mushrooms",
      storageLocation: "FRIDGE",
      unit: "oz",
      lots: [
        lot({
          lotId: "fixture-item-mushrooms-lot-1",
          expiresDays: 3,
          amount: "8.000000",
          amountMicros: "8000000",
          unit: "oz",
          tier: "ESTIMATED",
        }),
      ],
      initialMicros: 8_000_000n,
      tier: "AI_INTERPRETATION",
      needsConfirmWhenUnconfirmed: true,
      source: "receipt read “CREMINI MUSHRM 8OZ”",
    }),
    baseItem({
      itemId: "fixture-item-yogurt",
      displayName: "Greek yogurt",
      storageLocation: "FRIDGE",
      unit: "oz",
      lots: [
        lot({
          lotId: "fixture-item-yogurt-lot-1",
          expiresDays: 10,
          amount: "16.000000",
          amountMicros: "16000000",
          unit: "oz",
        }),
        lot({
          lotId: "fixture-item-yogurt-lot-2",
          expiresDays: 10,
          amount: "16.000000",
          amountMicros: "16000000",
          unit: "oz",
        }),
        lot({
          lotId: "fixture-item-yogurt-lot-3",
          expiresDays: 10,
          amount: "16.000000",
          amountMicros: "16000000",
          unit: "oz",
        }),
      ],
      initialMicros: 48_000_000n,
      tier: "KNOWN_FACT",
      needsConfirmWhenUnconfirmed: false,
      source: "scanned barcode",
    }),
    baseItem({
      itemId: "fixture-item-eggs",
      displayName: "Eggs",
      storageLocation: "FRIDGE",
      unit: "count",
      lots: [
        lot({
          lotId: "fixture-item-eggs-lot-1",
          label: "carton of 12",
          expiresDays: 14,
          amount: "8.000000",
          amountMicros: "8000000",
          unit: "count",
        }),
      ],
      initialMicros: 8_000_000n,
      tier: "KNOWN_FACT",
      needsConfirmWhenUnconfirmed: false,
      source: "scanned barcode",
    }),
    baseItem({
      itemId: "fixture-item-salmon",
      displayName: "Salmon fillets",
      storageLocation: "FREEZER",
      unit: "oz",
      lots: [
        lot({
          lotId: "fixture-item-salmon-lot-1",
          expiresDays: 60,
          amount: "6.000000",
          amountMicros: "6000000",
          unit: "oz",
        }),
        lot({
          lotId: "fixture-item-salmon-lot-2",
          expiresDays: 60,
          amount: "6.000000",
          amountMicros: "6000000",
          unit: "oz",
        }),
      ],
      initialMicros: 12_000_000n,
      tier: "KNOWN_FACT",
      needsConfirmWhenUnconfirmed: false,
      source: "scanned barcode",
    }),
    baseItem({
      itemId: "fixture-item-rice",
      displayName: "Basmati rice",
      storageLocation: "PANTRY",
      unit: "cup",
      lots: [
        lot({
          lotId: "fixture-item-rice-lot-1",
          amount: "4.000000",
          amountMicros: "4000000",
          unit: "cup",
          tier: "ESTIMATED",
        }),
      ],
      initialMicros: 4_000_000n,
      tier: "ESTIMATED",
      needsConfirmWhenUnconfirmed: false,
      source: "estimated from meals logged",
    }),
    baseItem({
      itemId: "fixture-item-olive-oil",
      displayName: "Olive oil",
      storageLocation: "PANTRY",
      unit: "bottle",
      lots: [
        lot({
          lotId: "fixture-item-olive-oil-lot-1",
          label: "opened Aug 30",
          amount: "1.000000",
          amountMicros: "1000000",
          unit: "bottle",
        }),
      ],
      initialMicros: 1_000_000n,
      tier: "KNOWN_FACT",
      needsConfirmWhenUnconfirmed: false,
      source: "manual entry",
    }),
  ];

  return new Map(items.map((item) => [item.itemId, item]));
}
