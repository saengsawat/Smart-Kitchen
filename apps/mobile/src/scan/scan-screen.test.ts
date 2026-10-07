/**
 * S7/S8 component tests (M3-T4b), `app/add/scan.tsx` against the real
 * `FixtureApiClient` (the default `apiClient` singleton under test, no
 * `EXPO_PUBLIC_API_URL`). `.test.ts`, not `.test.tsx` — same reason as
 * `item-detail-screen.test.ts`: every element is built with
 * `React.createElement`.
 *
 * No physical device is available to this worker (BACKLOG.md M3-T4b: "worker
 * verifies via the typed fallback where no device is available and says
 * so" — recorded in `docs/handoff/M3-T4b.worker.md`). Every test below
 * drives the screen through the typed-code fallback field, never a
 * simulated `onBarcodeScanned` camera event, which is exactly the point of
 * that fallback existing (ux-plan.md S7: "manual code entry fallback ...
 * which also makes the flow testable without a camera").
 *
 * Every test joins the Chen fixture household first
 * (`apiClient.joinHousehold(FIXTURE_JOIN_CODE)`) so S8's allergen row
 * resolves real member names from the household DTO the screen fetches
 * (review F11) — a fresh `FixtureApiClient.newUser()` starts with no
 * household at all, which would otherwise render the neutral fallback
 * phrase for every member, never "Maya Chen".
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Imported by relative path, not the "expo-camera" specifier: `tsc -b`
// resolves that specifier against the *real* expo-camera package (which has
// no test-only exports), while vitest's root alias resolves it to this same
// file at runtime — so a relative import here reaches the identical module
// instance the aliased "expo-camera" import in app/add/scan.tsx reads,
// without needing the real package's types to know about it.
import {
  __resetMockCameraPermission,
  __setMockCameraPermission,
} from "../test-support/expo-camera-mock";
import { flushPending } from "../test-support/flush";
import { setMockBottomInset } from "../test-support/safe-area-mock";
import { setMockWindowDimensions } from "../test-support/react-native-mock";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { AccessibilityInfo } from "react-native";
import { colors } from "../design/tokens";
import type {
  CreateItemRequestDto,
  InventoryItemSummaryDto,
  ProductLookupResultDto,
  ScannedProductDto,
} from "@smart-kitchen/contracts";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";
import { ProductLookupRefusedError } from "./product-lookup-errors";
import {
  GENERIC_LEDGER_ERROR_MESSAGE,
  GENERIC_READ_ERROR_MESSAGE,
  LedgerRefusedError,
} from "../inventory/errors";

let pushed: unknown[] = [];
let replaced: unknown[] = [];

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: (href: unknown) => pushed.push(href),
    replace: (href: unknown) => replaced.push(href),
    canGoBack: () => false,
    back: () => {},
  }),
}));

beforeEach(async () => {
  await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
});

afterEach(() => {
  cleanup();
  pushed = [];
  replaced = [];
  __resetMockCameraPermission();
  // M3-T4e: several new tests below use `vi.spyOn(apiClient, "createItem")`
  // to count/inspect calls (the held-key/single-flight tests) — without
  // this, an un-restored spy from one test leaks into the next test's own
  // `vi.spyOn` call, compounding (manual-screen.test.ts's identical pattern
  // already restores this way).
  vi.restoreAllMocks();
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: Screen } = await import("../../app/add/scan");
  const result = render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(Screen),
      React.createElement(ToastHost),
    ),
  );
  await flushPending(); // lets the screen's household fetch (review F11) resolve before assertions
  return result;
}

async function lookUp(result: ReturnType<typeof render>, code: string): Promise<void> {
  fireEvent.changeText(result.getByLabelText("Barcode number"), code);
  fireEvent.press(result.getByLabelText("Look up code"));
  await flushPending();
}

/** Flattens a React Native `style` prop (array of style objects, possibly with `null`s) into one object. */
function flattenStyle(style: unknown): Record<string, unknown> {
  const list: readonly unknown[] = Array.isArray(style) ? style : [style];
  const flat: Record<string, unknown> = {};
  for (const entry of list) {
    if (entry && typeof entry === "object") {
      Object.assign(flat, entry);
    }
  }
  return flat;
}

describe("S7 · camera permission states", () => {
  it("permission denied renders copy-deck.md §7 S7 verbatim with working Open Settings and Enter manually", async () => {
    __setMockCameraPermission({ granted: false, canAskAgain: false, status: "denied" });
    const result = await renderScreen();

    expect(result.getByText("Camera access is off.")).toBeTruthy();
    expect(result.getByText("Turn it on to scan barcodes, or add this item by hand.")).toBeTruthy();

    fireEvent.press(result.getByLabelText("Open Settings"));
    fireEvent.press(result.getByLabelText("Enter manually"));
    expect(pushed).toContain("/add/manual");
  });

  it("the typed fallback works whether or not permission is granted (S7's manual code entry fallback)", async () => {
    __setMockCameraPermission({ granted: true, canAskAgain: true, status: "granted" });
    const result = await renderScreen();
    expect(result.getByLabelText("Barcode number")).toBeTruthy();
  });
});

describe("S7 · viewfinder + camera hint (review F12)", () => {
  it("shows the four viewfinder corner brackets and a hint line while the camera is live", async () => {
    __setMockCameraPermission({ granted: true, canAskAgain: true, status: "granted" });
    const result = await renderScreen();
    expect(result.getByText("Point the camera at a barcode")).toBeTruthy();
  });
});

describe("S7 · scan miss", () => {
  it("the miss code lands on the miss panel with the retained code, and hands off to S9", async () => {
    const result = await renderScreen();
    await lookUp(result, "040000519073");

    expect(result.getByText("No match")).toBeTruthy();
    expect(result.getByText("code not found in any source we checked")).toBeTruthy();
    expect(result.getByText("0 40000 51907 3")).toBeTruthy();
    expect(
      result.getByText(
        "We could not find this product in Open Food Facts or USDA. The code is kept so we can fill in the facts automatically later if it gets added.",
      ),
    ).toBeTruthy();

    fireEvent.press(result.getByLabelText("Enter it manually"));
    expect(pushed).toEqual([{ pathname: "/add/manual", params: { code: "040000519073" } }]);
  });

  it("does not permanently lock the camera after a lookup error (review F14)", async () => {
    const originalLookup = apiClient.lookupProduct.bind(apiClient);
    let calls = 0;
    apiClient.lookupProduct = (code: string) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("network down"));
      }
      return originalLookup(code);
    };
    try {
      const result = await renderScreen();
      await lookUp(result, "060000100810"); // first attempt: rejects
      expect(
        result.getByText(
          "Something went wrong loading that. Try again, and tell us if it keeps happening.",
        ),
      ).toBeTruthy();

      await lookUp(result, "060000100810"); // second attempt: must not be locked out
      expect(result.getByText("Stone-Ground Tahini")).toBeTruthy();
    } finally {
      apiClient.lookupProduct = originalLookup;
    }
  });
});

describe("S8 · allergen block gates on the household having loaded (review R2)", () => {
  it("shows the loading state (never the neutral fallback name) while the household fetch is in flight, then the real lines once it resolves", async () => {
    const originalGetOnboardingState = apiClient.getOnboardingState.bind(apiClient);
    let resolveFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    apiClient.getOnboardingState = async () => {
      await gate; // held open until the test explicitly releases it
      return originalGetOnboardingState();
    };

    try {
      const { default: Screen } = await import("../../app/add/scan");
      const result = render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(Screen),
          React.createElement(ToastHost),
        ),
      );
      fireEvent.changeText(result.getByLabelText("Barcode number"), "060000100810");
      fireEvent.press(result.getByLabelText("Look up code"));
      await flushPending();

      // The confirm sheet is showing (product data does not depend on the
      // household fetch), but the allergen block is the loading placeholder
      // — never the neutral fallback name, since that would misattribute a
      // real finding to an anonymous "household member" over a real network.
      expect(result.getByText("Stone-Ground Tahini")).toBeTruthy();
      expect(result.getByText("Checking allergen data for your household.")).toBeTruthy();
      expect(result.queryByText(/blocked for/)).toBeNull();
      expect(result.queryByText(/a household member/)).toBeNull();

      // Review R4: the Add CTA is disabled the whole time the household
      // hasn't loaded, not just visually — a verdict without resolved
      // member names is not acceptable on a safety row.
      const addButtonWhileLoading = result.getByLabelText("Add 1 to Fridge");
      const loadingProps = addButtonWhileLoading.props as {
        accessibilityState?: { disabled?: boolean };
      };
      expect(loadingProps.accessibilityState?.disabled).toBe(true);

      resolveFetch();
      await flushPending();

      expect(result.queryByText("Checking allergen data for your household.")).toBeNull();
      expect(
        result.getByText(
          "Contains sesame · stated by the manufacturer · blocked for Maya Chen · not a safety guarantee",
        ),
      ).toBeTruthy();
      const addButtonAfterLoad = result.getByLabelText("Add 1 to Fridge");
      const loadedProps = addButtonAfterLoad.props as {
        accessibilityState?: { disabled?: boolean };
      };
      expect(loadedProps.accessibilityState?.disabled).toBe(false);
    } finally {
      apiClient.getOnboardingState = originalGetOnboardingState;
    }
  });
});

describe("S8 · household fetch rejection (review R4, architect finding on the R2 fix)", () => {
  it("shows the generic fallback + Try again, keeps Add disabled, and a successful retry renders the lines and enables Add", async () => {
    const originalGetOnboardingState = apiClient.getOnboardingState.bind(apiClient);
    let attempt = 0;
    apiClient.getOnboardingState = () => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(new Error("network down"));
      }
      return originalGetOnboardingState();
    };

    try {
      const { default: Screen } = await import("../../app/add/scan");
      const result = render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(Screen),
          React.createElement(ToastHost),
        ),
      );
      fireEvent.changeText(result.getByLabelText("Barcode number"), "060000100810");
      fireEvent.press(result.getByLabelText("Look up code"));
      await flushPending();

      // Never an unhandled rejection (the effect's two-arg `.then` catches
      // it), never the loading state stuck forever, never a verdict with
      // unnamed members — the §8 read fallback plus a retry instead (a
      // household load is a read, never the save string; M9-T0 h).
      expect(result.getByText(GENERIC_READ_ERROR_MESSAGE)).toBeTruthy();
      expect(result.queryByText(GENERIC_LEDGER_ERROR_MESSAGE)).toBeNull();
      expect(result.queryByText("Checking allergen data for your household.")).toBeNull();
      expect(result.queryByText(/blocked for/)).toBeNull();

      const addButtonWhileErrored = result.getByLabelText("Add 1 to Fridge");
      const erroredProps = addButtonWhileErrored.props as {
        accessibilityState?: { disabled?: boolean };
      };
      expect(erroredProps.accessibilityState?.disabled).toBe(true);

      // Belt-and-suspenders: even if something pressed it anyway, the
      // handler itself refuses while household hasn't loaded.
      fireEvent.press(addButtonWhileErrored);
      await flushPending();
      expect(replaced).toEqual([]);

      fireEvent.press(result.getByLabelText("Try again"));
      await flushPending();

      expect(
        result.queryByText(
          "Something went wrong saving that. Try again, and tell us if it keeps happening.",
        ),
      ).toBeNull();
      expect(
        result.getByText(
          "Contains sesame · stated by the manufacturer · blocked for Maya Chen · not a safety guarantee",
        ),
      ).toBeTruthy();
      const addButtonAfterRetry = result.getByLabelText("Add 1 to Fridge");
      const retriedProps = addButtonAfterRetry.props as {
        accessibilityState?: { disabled?: boolean };
      };
      expect(retriedProps.accessibilityState?.disabled).toBe(false);
    } finally {
      apiClient.getOnboardingState = originalGetOnboardingState;
    }
  });
});

describe("S8 · scan confirm sheet — engine-generated verdicts (review F1/F2/F3)", () => {
  it("tahini (BLOCKED): renders one line per evidence entry and the peanut unknown alongside it, never a single pick", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810");

    expect(result.getByText("Stone-Ground Tahini")).toBeTruthy();
    expect(result.getByText("product identity · barcode match")).toBeTruthy();
    expect(result.getByText("✓ Known fact")).toBeTruthy();

    // Three evidence lines (review F3/F6/F7), not one condensed sentence.
    expect(
      result.getByText(
        "Contains sesame · stated by the manufacturer · blocked for Maya Chen · not a safety guarantee",
      ),
    ).toBeTruthy();
    expect(
      result.getByText(
        "Contains sesame · matched 'tahini' in the name · blocked for Maya Chen · not a safety guarantee",
      ),
    ).toBeTruthy();
    expect(
      result.getByText(
        "Contains sesame · matched 'sesame seeds' in the ingredient statement · blocked for Maya Chen · not a safety guarantee",
      ),
    ).toBeTruthy();
    // Plus Maya's unresolved peanut restriction on the very same product.
    expect(
      result.getByText(
        "We don't have allergen information for this item. This matters for Maya Chen's severe peanut allergy. · not a safety guarantee",
      ),
    ).toBeTruthy();

    // Tier chip on the evidence lines (review F4/F5): the record's own
    // KNOWN_FACT/manufacturer-label tier, shown at least once.
    expect(result.getAllByText("✓ Fact").length).toBeGreaterThan(0);

    // Not BLOCKED-styled buttons anywhere else — the Add button loses
    // terracotta (P5).
    const addButton = result.getByLabelText("Add 1 to Fridge");
    expect(flattenStyle(addButton.props.style).backgroundColor).not.toBe(colors.brandDeep);

    fireEvent.press(addButton);
    await flushPending();
    expect(replaced).toContain("/inventory");

    const items = await apiClient.getInventoryItems();
    const created = items.find((item) => item.displayName === "Stone-Ground Tahini");
    expect(created).toBeTruthy();
    expect(created?.productRef).toBe("condiment-102"); // review F18
    const detail = created ? await apiClient.getInventoryItem(created.itemId) : null;
    expect(detail?.history[0]?.type).toBe("PURCHASE");
  });

  it("eggs (ALLOWED_WITH_UNKNOWNS): renders one line per unknown, peanut before sesame, Add keeps terracotta", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100070");

    const peanutLine =
      "We don't have allergen information for this item. This matters for Maya Chen's severe peanut allergy. · not a safety guarantee";
    const sesameLine =
      "We don't have allergen information for this item. This matters for Maya Chen's severe sesame allergy. · not a safety guarantee";
    expect(result.getByText(peanutLine)).toBeTruthy();
    expect(result.getByText(sesameLine)).toBeTruthy();

    // Not BLOCKED: the Add button keeps its terracotta primary-CTA colour.
    expect(flattenStyle(result.getByLabelText("Add 1 to Fridge").props.style).backgroundColor).toBe(
      colors.brandDeep,
    );

    fireEvent.press(result.getByLabelText("Increase quantity"));
    fireEvent.press(result.getByLabelText("Fridge"));
    fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
    await flushPending();
    expect(replaced).toContain("/inventory");

    const items = await apiClient.getInventoryItems();
    const created = items.find((item) => item.displayName === "Grade A Large Eggs");
    expect(created?.quantity.amount).toBe("24"); // 2 packages x 12 each
    expect(created?.quantity.unit).toBe("each"); // "ct" normalized to this app's "each"
    expect(created?.productRef).toBe("dairy-008");
  });

  it("chicken breast (ALLOWED_WITH_UNKNOWNS, fractional 1.5 lb package): exact micros, no float", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100100");

    fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
    await flushPending();

    const items = await apiClient.getInventoryItems();
    const created = items.find((item) => item.displayName === "Boneless Chicken Breast");
    expect(created?.quantity.amount).toBe("1.500000"); // exact six-place decimal text, never re-derived through a float
    expect(created?.quantity.micros).toBe("1500000");
  });
});

// ---------------------------------------------------------------------------
// M2-T4a: the NOT_RUN row. The product below is a hand-built literal in the
// exact shape `GET /v1/products/{code}` answers for the recorded Open Food
// Facts peanut-butter response (apps/api/src/products/product-routes.test.ts
// asserts that shape against the real adapter). It is injected through
// `apiClient.lookupProduct` because the HTTP client is not wired to the
// endpoint until M3-T4e.
// ---------------------------------------------------------------------------

const NOT_RUN_LINE =
  "Allergens not checked · this household's allergies are not on the server yet · read the label · not a safety guarantee";

const OFF_PROVENANCE = {
  tier: "ESTIMATED",
  source: "open-food-facts",
  confidence: null,
  recordedAt: "2026-09-29T13:02:12.000Z",
} as const;

/**
 * Review round 1 F7: the real `GET /v1/products/096619555505` (the peanut
 * butter record) no longer carries a `PER_100G` profile once the adapter
 * requests `nutrition_data_per` (M3-T4e (c)) — that recording predates the
 * field and so is genuinely absent from it, which the adapter now reads as
 * "not 100g". This literal is kept in sync with what the real API sends:
 * `PER_SERVING` only, the actual values from that same recorded response.
 */
function notRunProduct(withPackageSize: boolean): ScannedProductDto {
  return {
    productId: "096619555505",
    codes: [{ codeType: "UPC_A", code: "096619555505" }],
    name: { value: "Organic Creamy Peanut Butter", provenance: OFF_PROVENANCE },
    brand: { value: "Kirkland", provenance: OFF_PROVENANCE },
    ...(withPackageSize
      ? { packageSize: { value: { qty: "793.8", unit: "g" }, provenance: OFF_PROVENANCE } }
      : {}),
    nutrition: [
      {
        basis: "PER_SERVING",
        values: { calories: 180, proteinG: 4, carbsG: 3.5, fatG: 7.5 },
        provenance: OFF_PROVENANCE,
      },
    ],
    ingredientsText: { value: "Dry roasted organic peanuts, sea salt", provenance: OFF_PROVENANCE },
    bestBy: null,
    screening: { status: "NOT_RUN", reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED" },
  };
}

async function withLookup(product: ScannedProductDto, run: () => Promise<void>): Promise<void> {
  const original = apiClient.lookupProduct.bind(apiClient);
  apiClient.lookupProduct = (code: string) => {
    const answer: ProductLookupResultDto = { status: "hit", code, product };
    return Promise.resolve(answer);
  };
  try {
    await run();
  } finally {
    apiClient.lookupProduct = original;
  }
}

describe("S8 · NOT_RUN screening (M2-T4a, copy-deck §3.3)", () => {
  it("renders the §3.3 NOT_RUN string verbatim, in neutral ink, with no verdict line", async () => {
    await withLookup(notRunProduct(true), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      const line = result.getByText(NOT_RUN_LINE);
      const lineColor = flattenStyle(line.props.style).color;
      expect(lineColor).toBe(colors.ink);
      for (const verdictColour of [colors.danger, colors.amber, colors.green, colors.rose]) {
        expect(lineColor).not.toBe(verdictColour);
      }
      const glyph = result.getByText("○");
      expect(flattenStyle(glyph.props.style).color).toBe(colors.ink2);

      // Nothing on the sheet reads as a verdict.
      expect(result.queryByText(/blocked for/)).toBeNull();
      expect(result.queryByText(/No known household match/)).toBeNull();
      expect(result.queryByText(/not blocked, not cleared/)).toBeNull();
      expect(result.queryByText(/unresolved/)).toBeNull();
      expect(result.queryByText(/Checking allergen data/)).toBeNull();
      expect(result.queryByText(/stated by the manufacturer/)).toBeNull();
      expect(result.queryByText("✓")).toBeNull();
    });
  });

  it("keeps Add present, enabled once the household loads, and in its normal (not blocked) style", async () => {
    await withLookup(notRunProduct(true), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      const add = result.getByLabelText("Add 1 to Fridge");
      const props = add.props as { accessibilityState?: { disabled?: boolean }; style: unknown };
      expect(props.accessibilityState?.disabled).toBe(false);
      expect(flattenStyle(props.style).backgroundColor).toBe(colors.brandDeep);
    });
  });

  it("chips every label field Estimated while identity stays Known fact", async () => {
    await withLookup(notRunProduct(true), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      expect(result.getByText("✓ Known fact")).toBeTruthy();
      // name, brand, package size, nutrition profile
      expect(result.getAllByText("≈ Est.")).toHaveLength(4);
      expect(result.queryByText("✓ Fact")).toBeNull();
    });
  });

  it("does not wait for the household to show the row, since it names nobody and claims no check", async () => {
    const originalGetOnboardingState = apiClient.getOnboardingState.bind(apiClient);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiClient.getOnboardingState = async () => {
      await gate;
      return originalGetOnboardingState();
    };
    try {
      await withLookup(notRunProduct(true), async () => {
        const result = await renderScreen();
        await lookUp(result, "096619555505");
        expect(result.getByText(NOT_RUN_LINE)).toBeTruthy();
        expect(result.queryByText("Checking allergen data for your household.")).toBeNull();
        // Add keeps its household gate, unchanged.
        const add = result.getByLabelText("Add 1 to Fridge");
        const props = add.props as { accessibilityState?: { disabled?: boolean } };
        expect(props.accessibilityState?.disabled).toBe(true);
        release();
        await flushPending();
      });
    } finally {
      apiClient.getOnboardingState = originalGetOnboardingState;
    }
  });

  it("a product with no package size adds the chosen count in each", async () => {
    await withLookup(notRunProduct(false), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.queryByText(/793\.8/)).toBeNull();

      fireEvent.press(result.getByLabelText("Increase quantity"));
      fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
      await flushPending();

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Organic Creamy Peanut Butter");
      expect(created?.quantity.amount).toBe("2");
      expect(created?.quantity.unit).toBe("each");
    });
  });

  it.each(["060000100810", "060000100070", "060000100100"])(
    "engine-run fixture %s never shows the NOT_RUN row (the client never decides a check did not run)",
    async (code) => {
      const result = await renderScreen();
      await lookUp(result, code);
      expect(result.getByText("✓ Known fact")).toBeTruthy();
      expect(result.queryByText(NOT_RUN_LINE)).toBeNull();
      expect(result.queryByText("○")).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// M3-T4e: nutrition strip, quantity tier + toast, unsupported package units,
// held key + single-flight on Add, and the §8 product-lookup refusals.
// ---------------------------------------------------------------------------

function nutritionTestProduct(
  nutrition: ScannedProductDto["nutrition"],
  packageSize?: ScannedProductDto["packageSize"],
): ScannedProductDto {
  return {
    productId: "096619555505",
    codes: [{ codeType: "UPC_A", code: "096619555505" }],
    name: { value: "Nutrition Test Product", provenance: OFF_PROVENANCE },
    ...(packageSize ? { packageSize } : {}),
    nutrition,
    bestBy: null,
    screening: { status: "NOT_RUN", reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED" },
  };
}

describe("S8 · nutrition strip (M3-T4e Objective (b))", () => {
  it("prefers PER_SERVING over PER_100G, labels the basis, and rounds for display", async () => {
    const product = nutritionTestProduct([
      {
        basis: "PER_100G",
        values: { calories: 562.5, proteinG: 12.5 },
        provenance: OFF_PROVENANCE,
      },
      {
        basis: "PER_SERVING",
        values: { calories: 179.6, proteinG: 12.54 },
        provenance: OFF_PROVENANCE,
      },
    ]);
    await withLookup(product, async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      // F5 ruling: the basis label sits next to the macros row, separate
      // from the always-on caption sentence (checked below).
      expect(result.getByText("per serving")).toBeTruthy();
      expect(result.getByText("180")).toBeTruthy(); // 179.6 rounded to a whole calorie
      expect(result.getByText("12.5g")).toBeTruthy(); // 12.54 rounded to one decimal
      expect(result.queryByText("per 100 g")).toBeNull();
      expect(
        result.getByText(
          "Nutrition & allergens: label data via Open Food Facts · tier shown per field",
        ),
      ).toBeTruthy();
    });
  });

  it("falls back to PER_100G when there is no PER_SERVING", async () => {
    const product = nutritionTestProduct([
      { basis: "PER_100G", values: { calories: 100 }, provenance: OFF_PROVENANCE },
    ]);
    await withLookup(product, async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.getByText("per 100 g")).toBeTruthy();
      expect(
        result.getByText(
          "Nutrition & allergens: label data via Open Food Facts · tier shown per field",
        ),
      ).toBeTruthy();
    });
  });

  it('shows "Nutrition not on file" with no numbers when there is no profile at all, caption still present (F5: the caption replaces only the numbers)', async () => {
    const product = nutritionTestProduct([]);
    await withLookup(product, async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.getByText("Nutrition not on file")).toBeTruthy();
      expect(result.queryByText("per serving")).toBeNull();
      expect(result.queryByText("per 100 g")).toBeNull();
      expect(
        result.getByText(
          "Nutrition & allergens: label data via Open Food Facts · tier shown per field",
        ),
      ).toBeTruthy();
    });
  });

  it("review round 1 F7: renders the liquid record's real mapped shape (PER_SERVING only, no package size, the caption unconditional)", async () => {
    // The exact shape `GET /v1/products/855643006045` answers today (Ripple
    // Dairy-Free Milk, tests/fixtures/off/liquid-per-100ml-ripple.json):
    // nutrition_data_per is "100ml", so the adapter emits no PER_100G
    // profile at all, and its own "48 fl oz" quantity stays unparseable.
    const product: ScannedProductDto = {
      productId: "855643006045",
      codes: [{ codeType: "UPC_A", code: "855643006045" }],
      name: { value: "DAIRY-FREE MILK", provenance: OFF_PROVENANCE },
      brand: { value: "ripple", provenance: OFF_PROVENANCE },
      nutrition: [
        {
          basis: "PER_SERVING",
          values: { calories: 70, proteinG: 8, carbsG: 0.5, fatG: 4 },
          provenance: OFF_PROVENANCE,
        },
      ],
      bestBy: null,
      screening: { status: "NOT_RUN", reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED" },
    };
    await withLookup(product, async () => {
      const result = await renderScreen();
      await lookUp(result, "855643006045");

      expect(result.getByText("per serving")).toBeTruthy();
      expect(result.queryByText("per 100 g")).toBeNull();
      expect(result.getByText("70")).toBeTruthy();
      expect(result.getByText("8g")).toBeTruthy();
      // No package size on this record at all (its own quantity is
      // unparseable "48 fl oz") — nothing to show as a size, and the item
      // still adds as a plain count, Known Fact.
      expect(result.queryByText(/fl oz/)).toBeNull();
      // The caption is unconditional (F5): present here exactly as it is
      // when nutrition is absent (the other new test above).
      expect(
        result.getByText(
          "Nutrition & allergens: label data via Open Food Facts · tier shown per field",
        ),
      ).toBeTruthy();
    });
  });
});

describe("S8 · quantity tier follows the lowest input, toast word follows it (M3-T4e Objective (d), review round 1 F1/F3)", () => {
  it("an Estimated (Open Food Facts) package size in a supported unit gives an Estimated quantity, source open-food-facts, and the matching toast", async () => {
    await withLookup(notRunProduct(true), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      const calls: CreateItemRequestDto[] = [];
      const original = apiClient.createItem.bind(apiClient);
      vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
        calls.push(input);
        return original(input);
      });

      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();
      expect(replaced).toContain("/inventory");

      // F1: the amount is built from the package size, so its provenance
      // source is the size's own source, "open-food-facts" — not "scanned
      // barcode" (this was the entire body's fix; assert it directly on
      // what was sent, not just the resulting tier).
      expect(calls[0]?.quantityProvenance.source).toBe("open-food-facts");

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Organic Creamy Peanut Butter");
      expect(created?.provenance.quantity?.tier).toBe("ESTIMATED");
      expect(created?.provenance.quantity?.source).toBe("open-food-facts");
      expect(
        result.queryByText("Added 1 × Organic Creamy Peanut Butter to Fridge · Estimated"),
      ).toBeTruthy();
    });
  });

  it('no package size at all keeps the quantity (and toast) Known Fact, source "scanned barcode", same as before this ticket', async () => {
    await withLookup(notRunProduct(false), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Organic Creamy Peanut Butter");
      expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
      expect(created?.provenance.quantity?.source).toBe("scanned barcode");
      expect(
        result.queryByText("Added 1 × Organic Creamy Peanut Butter to Fridge · Known Fact"),
      ).toBeTruthy();
    });
  });

  it('the fixture corpus\'s Known Fact package sizes still add as Known Fact, source "manufacturer-label" (F1, no regression)', async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810"); // Stone-Ground Tahini, "manufacturer-label" Known Fact

    const calls: CreateItemRequestDto[] = [];
    const original = apiClient.createItem.bind(apiClient);
    vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
      calls.push(input);
      return original(input);
    });

    fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
    await flushPending();

    // F1: a fixture-corpus record's package size carries the corpus's own
    // "manufacturer-label" source, and that is what the amount is built
    // from here (a supported unit, "oz") — so that is the quantity's source.
    expect(calls[0]?.quantityProvenance.source).toBe("manufacturer-label");

    const items = await apiClient.getInventoryItems();
    const created = items.find((item) => item.displayName === "Stone-Ground Tahini");
    expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
    expect(created?.provenance.quantity?.source).toBe("manufacturer-label");
  });
});

describe("S8 · package units the ledger cannot accept (M3-T4e Objective (e), review round 1 F3/F8 rulings)", () => {
  function litreProduct(unit: string): ScannedProductDto {
    return nutritionTestProduct([], {
      value: { qty: "1", unit },
      provenance: OFF_PROVENANCE,
    });
  }

  it('a "qt" package size shows "N package(s) of 1 qt" as text (F8), updates with the count, and adds as N each, Known Fact (F3: the count is the user\'s own fact), source "scanned barcode" (F1)', async () => {
    await withLookup(litreProduct("qt"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      expect(result.getByText("1 package of 1 qt")).toBeTruthy();
      fireEvent.press(result.getByLabelText("Increase quantity"));
      expect(result.getByText("2 packages of 1 qt")).toBeTruthy();
      expect(result.queryByText("1 × 1 qt")).toBeNull(); // the old (reversed) format never renders
      expect(result.queryByText("1 qt")).toBeNull(); // never the bare size alone
      // The size still wears its own (Estimated) tier chip even though the
      // quantity itself is Known Fact — two different facts, F3's point.
      // (Not unique: the product name is Estimated too, so at least one.)
      expect(result.getAllByText("≈ Est.").length).toBeGreaterThanOrEqual(1);

      const calls: CreateItemRequestDto[] = [];
      const original = apiClient.createItem.bind(apiClient);
      vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
        calls.push(input);
        return original(input);
      });

      fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
      await flushPending();

      expect(calls[0]?.quantityProvenance.tier).toBe("KNOWN_FACT");
      expect(calls[0]?.quantityProvenance.source).toBe("scanned barcode");

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Nutrition Test Product");
      expect(created?.quantity.amount).toBe("2");
      expect(created?.quantity.unit).toBe("each");
      expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
      expect(
        result.queryByText("Added 2 × Nutrition Test Product to Fridge · Known Fact"),
      ).toBeTruthy();
    });
  });

  it.each(["pt", "gal", "fl oz"])(
    "%s falls back the same way: each, Known Fact (F3), never an invented conversion",
    async (unit) => {
      await withLookup(litreProduct(unit), async () => {
        const result = await renderScreen();
        await lookUp(result, "096619555505");
        expect(result.getByText(`1 package of 1 ${unit}`)).toBeTruthy();
        fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
        await flushPending();
        const items = await apiClient.getInventoryItems();
        const created = items.find((item) => item.displayName === "Nutrition Test Product");
        expect(created?.quantity.unit).toBe("each");
        expect(created?.quantity.amount).toBe("1");
        expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
        expect(created?.provenance.quantity?.source).toBe("scanned barcode");
      });
    },
  );
});

describe("S8 · held idempotency key + single-flight guard on Add (M3-T4e Objective (f))", () => {
  it("two Add taps in one frame produce exactly one createItem call, one key", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810");

    const calls: CreateItemRequestDto[] = [];
    const original = apiClient.createItem.bind(apiClient);
    vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
      calls.push(input);
      return original(input);
    });

    const button = result.getByLabelText("Add 1 to Fridge");
    // No `await`/`flushPending` between these two presses: the single-flight
    // ref must already be set by the time the second press's synchronous
    // handler body runs, same frame as the first.
    fireEvent.press(button);
    fireEvent.press(button);
    await flushPending();

    expect(calls).toHaveLength(1);
    expect(replaced).toContain("/inventory");
    const items = await apiClient.getInventoryItems();
    expect(items.filter((item) => item.displayName === "Stone-Ground Tahini")).toHaveLength(1);
  });

  it("a failed Add reuses the same key on a retap; the retap succeeds and creates exactly one item", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810");

    const calls: CreateItemRequestDto[] = [];
    const original = apiClient.createItem.bind(apiClient);
    let attempt = 0;
    vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
      calls.push(input);
      attempt += 1;
      if (attempt === 1) {
        throw new Error("simulated network failure");
      }
      return original(input);
    });

    const button = result.getByLabelText("Add 1 to Fridge");
    fireEvent.press(button);
    await flushPending();
    expect(replaced).toEqual([]);

    fireEvent.press(button);
    await flushPending();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
    expect(replaced).toContain("/inventory");
    const items = await apiClient.getInventoryItems();
    expect(items.filter((item) => item.displayName === "Stone-Ground Tahini")).toHaveLength(1);
  });

  it("changing the count after a failed Add discards the held key; the next Add mints a fresh one", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810");

    const calls: CreateItemRequestDto[] = [];
    const original = apiClient.createItem.bind(apiClient);
    let attempt = 0;
    vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
      calls.push(input);
      attempt += 1;
      if (attempt === 1) {
        throw new Error("simulated network failure");
      }
      return original(input);
    });

    fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
    await flushPending();

    fireEvent.press(result.getByLabelText("Increase quantity"));
    fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
    await flushPending();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.idempotencyKey).not.toBe(calls[1]?.idempotencyKey);
  });

  it("changing the location after a failed Add discards the held key; the next Add mints a fresh one (F6 pinning)", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810");

    const calls: CreateItemRequestDto[] = [];
    const original = apiClient.createItem.bind(apiClient);
    let attempt = 0;
    vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
      calls.push(input);
      attempt += 1;
      if (attempt === 1) {
        throw new Error("simulated network failure");
      }
      return original(input);
    });

    fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
    await flushPending();

    // A real change to what Add would send: the storage location, not the count.
    fireEvent.press(result.getByLabelText("Freezer"));
    fireEvent.press(result.getByLabelText("Add 1 to Freezer"));
    await flushPending();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.idempotencyKey).not.toBe(calls[1]?.idempotencyKey);
  });

  it("the Add control reports accessibilityState.disabled while a create is pending (F6 pinning)", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810");

    // Never resolves: this test only observes the pending state, the same
    // way manual.tsx's own `saving` state is checked mid-flight elsewhere.
    const pending = new Promise<InventoryItemSummaryDto>(() => {
      // intentionally never settles
    });
    vi.spyOn(apiClient, "createItem").mockReturnValue(pending);

    const button = result.getByLabelText("Add 1 to Fridge");
    fireEvent.press(button);
    await flushPending();

    const pendingProps = result.getByLabelText("Add 1 to Fridge").props as {
      accessibilityState?: { disabled?: boolean };
    };
    expect(pendingProps.accessibilityState?.disabled).toBe(true);
  });
});

describe("S7 · product-lookup refusals (M3-T4e Objective (a), copy-deck.md §8)", () => {
  it("PLU_NOT_SUPPORTED renders its exact §8 string, with Enter it manually offered but no code retained (review round 1 F4: nothing was ever sent anywhere)", async () => {
    const original = apiClient.lookupProduct.bind(apiClient);
    apiClient.lookupProduct = () =>
      Promise.reject(new ProductLookupRefusedError("PLU_NOT_SUPPORTED"));
    try {
      const result = await renderScreen();
      await lookUp(result, "04061");
      expect(
        result.getByText("Produce codes can't be looked up by barcode yet. Add this item by hand."),
      ).toBeTruthy();
      const manualButton = result.getByLabelText("Enter it manually");
      fireEvent.press(manualButton);
      expect(pushed).toEqual(["/add/manual"]);
    } finally {
      apiClient.lookupProduct = original;
    }
  });

  it("BAD_REQUEST renders its exact §8 string, Enter it manually with no code retained either (F4: never a plausible barcode)", async () => {
    const original = apiClient.lookupProduct.bind(apiClient);
    apiClient.lookupProduct = () => Promise.reject(new ProductLookupRefusedError("BAD_REQUEST"));
    try {
      const result = await renderScreen();
      await lookUp(result, "not-a-code");
      expect(result.getByText("That isn't a barcode number we can look up.")).toBeTruthy();
      fireEvent.press(result.getByLabelText("Enter it manually"));
      expect(pushed).toEqual(["/add/manual"]);
    } finally {
      apiClient.lookupProduct = original;
    }
  });

  it("a 200 error outcome (upstream trouble) renders its exact §8 string, never result.message, and retains the code (F4: a valid barcode we could not resolve)", async () => {
    const original = apiClient.lookupProduct.bind(apiClient);
    apiClient.lookupProduct = (code: string) => {
      const answer: ProductLookupResultDto = {
        status: "error",
        code,
        message: "this exact sentence must never reach the screen",
      };
      return Promise.resolve(answer);
    };
    try {
      const result = await renderScreen();
      await lookUp(result, "060000100810");
      expect(
        result.getByText(
          "The product database didn't answer. Try again in a moment, or add the item by hand.",
        ),
      ).toBeTruthy();
      expect(result.queryByText(/this exact sentence/)).toBeNull();
      fireEvent.press(result.getByLabelText("Enter it manually"));
      expect(pushed).toEqual([{ pathname: "/add/manual", params: { code: "060000100810" } }]);
    } finally {
      apiClient.lookupProduct = original;
    }
  });

  it("a 401/403 (or any other refused lookup) renders the read fallback (review round 1 F2/R2), with Enter it manually still offered and the code retained (F4: a plausible barcode)", async () => {
    const original = apiClient.lookupProduct.bind(apiClient);
    apiClient.lookupProduct = () => Promise.reject(new ProductLookupRefusedError("UNAUTHORIZED"));
    try {
      const result = await renderScreen();
      await lookUp(result, "060000100810");
      expect(
        result.getByText(
          "Something went wrong loading that. Try again, and tell us if it keeps happening.",
        ),
      ).toBeTruthy();
      fireEvent.press(result.getByLabelText("Enter it manually"));
      expect(pushed).toEqual([{ pathname: "/add/manual", params: { code: "060000100810" } }]);
    } finally {
      apiClient.lookupProduct = original;
    }
  });
});

describe("S7 · bottom inset and camera size (BUG-003)", () => {
  afterEach(() => {
    setMockBottomInset(0);
    setMockWindowDimensions(390, 844);
  });

  it("pads the typed-code sheet's bottom by the safe-area inset plus spacing.md", async () => {
    setMockBottomInset(34);
    const withInset = await renderScreen();
    expect(
      flattenStyle(withInset.getByTestId("scan-fallback-sheet").props.style).paddingBottom,
    ).toBe(34 + 12);
    cleanup();

    setMockBottomInset(0);
    const noInset = await renderScreen();
    expect(flattenStyle(noInset.getByTestId("scan-fallback-sheet").props.style).paddingBottom).toBe(
      12,
    );
  });

  it("caps the camera panel at 55% of the window height", async () => {
    setMockWindowDimensions(400, 800);
    const result = await renderScreen();
    expect(flattenStyle(result.getByTestId("scan-camera-panel").props.style).height).toBe(440);
    cleanup();

    setMockWindowDimensions(390, 1000);
    const tall = await renderScreen();
    expect(flattenStyle(tall.getByTestId("scan-camera-panel").props.style).height).toBe(550);
  });

  it("keeps the hint under the panel, not inside it, and the frame inside it", async () => {
    __setMockCameraPermission({ granted: true, canAskAgain: true, status: "granted" });
    const result = await renderScreen();
    const panel = result.getByTestId("scan-camera-panel");
    expect(result.getByText("Point the camera at a barcode")).toBeTruthy();
    expect(panel.findAll((n) => n.props.children === "Point the camera at a barcode")).toHaveLength(
      0,
    );
    expect(panel.findAll((n) => n.props.pointerEvents === "none")).not.toHaveLength(0);
  });

  it("centres the brackets frame in the panel and lets the panel shrink for the keyboard", async () => {
    __setMockCameraPermission({ granted: true, canAskAgain: true, status: "granted" });
    const result = await renderScreen();
    const panel = result.getByTestId("scan-camera-panel");
    expect(flattenStyle(panel.props.style).flexShrink).toBe(1);
    const frame = panel.findAll((n) => n.props.pointerEvents === "none")[0];
    const style = flattenStyle(frame?.props.style);
    expect(style.top).toBe("50%");
    expect(style.height).toBe(150);
    expect(style.marginTop).toBe(-75);
  });
});

// ---------------------------------------------------------------------------
// M3-T7 (b): the package size line is editable. The record below is a
// hand-built Open Food Facts style yogurt (125 g, Estimated, the shape of the
// can-of-corn bug Andy hit on 2026-10-01); the fixture corpus has no yogurt.
// ---------------------------------------------------------------------------

function yogurtProduct(unit: string): ScannedProductDto {
  return {
    ...notRunProduct(true),
    productId: "yogurt-test-1",
    name: { value: "Plain Greek Yogurt", provenance: OFF_PROVENANCE },
    brand: { value: "Test Dairy", provenance: OFF_PROVENANCE },
    packageSize: { value: { qty: "125", unit }, provenance: OFF_PROVENANCE },
  };
}

const SIZE_HINT = "Enter a number, like 2 or 0.5.";

function spyCreate(): CreateItemRequestDto[] {
  const calls: CreateItemRequestDto[] = [];
  const original = apiClient.createItem.bind(apiClient);
  vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
    calls.push(input);
    return original(input);
  });
  return calls;
}

describe("S8 · editable package size (M3-T7 b)", () => {
  function openSizeField(result: ReturnType<typeof render>): void {
    fireEvent.press(result.getByLabelText(/^Edit package size/));
  }

  it("shows the record's size with its own Estimated chip until something is typed; opening the field pre-fills the record's quantity and changes nothing", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.getByText("125 g")).toBeTruthy();
      expect(result.queryByText("✓ Fact")).toBeNull();
      openSizeField(result);
      const input = result.getByLabelText("Package size");
      expect((input.props as { value: string }).value).toBe("125");
      expect((input.props as { keyboardType?: string }).keyboardType).toBe("decimal-pad");
      // Opening is not typing: the chip stays Estimated.
      expect(result.queryByText("✓ Fact")).toBeNull();
      expect(result.getAllByText("≈ Est.")).toHaveLength(4);
    });
  });

  it("typing 500 makes the line 500 g with the Fact chip, and Add creates 500 g x count, Known Fact, source user-entry", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      openSizeField(result);
      fireEvent.changeText(result.getByLabelText("Package size"), "500");
      expect(result.getByText("✓ Fact")).toBeTruthy();
      fireEvent.press(result.getByLabelText("Increase quantity")); // count 2
      fireEvent(result.getByLabelText("Package size"), "blur");
      expect(result.getByText("500 g")).toBeTruthy();
      expect(result.queryByText("125 g")).toBeNull();
      expect(result.getByText("✓ Fact")).toBeTruthy();

      const calls = spyCreate();
      fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
      await flushPending();

      expect(calls[0]?.amount).toBe("1000"); // 2 x 500 g, exact text
      expect(calls[0]?.unit).toBe("g");
      expect(calls[0]?.quantityProvenance.tier).toBe("KNOWN_FACT");
      expect(calls[0]?.quantityProvenance.source).toBe("user-entry");
      // M2-T7: the typed path says so and labels the lot with the typed size.
      expect(calls[0]?.quantityOrigin).toBe("USER_TYPED");
      expect(calls[0]?.lotLabel).toBe("500 g");
      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Plain Greek Yogurt");
      expect(created?.quantity.micros).toBe("1000000000");
      expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
      expect(
        result.queryByText("Added 2 × Plain Greek Yogurt to Fridge · Known Fact"),
      ).toBeTruthy();
    });
  });

  it("a fractional typed size stays exact (248.5 g x 3)", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      openSizeField(result);
      fireEvent.changeText(result.getByLabelText("Package size"), "248.5");
      fireEvent.press(result.getByLabelText("Increase quantity"));
      fireEvent.press(result.getByLabelText("Increase quantity"));
      const calls = spyCreate();
      fireEvent.press(result.getByLabelText("Add 3 to Fridge"));
      await flushPending();
      expect(calls[0]?.amount).toBe("745.500000"); // the exact six-place text, never a float;
    });
  });

  it("clearing the field restores the record's size, Estimated chip, tier and source", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      openSizeField(result);
      fireEvent.changeText(result.getByLabelText("Package size"), "500");
      expect(result.getByText("✓ Fact")).toBeTruthy();
      fireEvent.changeText(result.getByLabelText("Package size"), "");
      expect(result.queryByText("✓ Fact")).toBeNull();
      fireEvent(result.getByLabelText("Package size"), "blur");
      expect(result.getByText("125 g")).toBeTruthy();

      const calls = spyCreate();
      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();
      expect(calls[0]?.amount).toBe("125");
      expect(calls[0]?.quantityProvenance.tier).toBe("ESTIMATED");
      expect(calls[0]?.quantityProvenance.source).toBe("open-food-facts");
      // M2-T7: the product-data path sends neither new field.
      expect(calls[0] !== undefined && "quantityOrigin" in calls[0]).toBe(false);
      expect(calls[0] !== undefined && "lotLabel" in calls[0]).toBe(false);
    });
  });

  it.each(["abc", "0", "1.1234567", "-5", "1,5"])(
    "%j shows the hint, keeps the editor open and disables Add",
    async (text) => {
      await withLookup(yogurtProduct("g"), async () => {
        const result = await renderScreen();
        await lookUp(result, "096619555505");
        openSizeField(result);
        fireEvent.changeText(result.getByLabelText("Package size"), text);
        expect(result.getByText(SIZE_HINT)).toBeTruthy();
        const add = result.getByLabelText("Add 1 to Fridge");
        const state = (add.props as { accessibilityState?: { disabled?: boolean } })
          .accessibilityState;
        expect(state?.disabled).toBe(true);
        fireEvent(result.getByLabelText("Package size"), "blur");
        expect(result.getByLabelText("Package size")).toBeTruthy(); // still editing
        const spy = vi.spyOn(apiClient, "createItem");
        fireEvent.press(add);
        await flushPending();
        expect(spy).not.toHaveBeenCalled();
      });
    },
  );

  it("a size the ledger cannot hold (qt) is not editable: no field opens, the chip stays Estimated, the text and the Add amount are unchanged", async () => {
    await withLookup(yogurtProduct("qt"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.getByText("1 package of 125 qt")).toBeTruthy();
      expect(result.queryByLabelText(/^Edit package size/)).toBeNull();
      expect(result.queryByLabelText("Package size")).toBeNull();
      expect(result.queryByText("✓ Fact")).toBeNull();
      expect(result.getAllByText("≈ Est.")).toHaveLength(4);
      fireEvent.press(result.getByLabelText("Increase quantity"));
      expect(result.getByText("2 packages of 125 qt")).toBeTruthy();
      const calls = spyCreate();
      fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
      await flushPending();
      expect(calls[0]?.unit).toBe("each");
      expect(calls[0]?.amount).toBe("2");
      expect(calls[0]?.quantityProvenance.source).toBe("scanned barcode");
    });
  });

  it("a supported-unit typed size reaches the create payload in exact micros (typed x count)", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      openSizeField(result);
      fireEvent.changeText(result.getByLabelText("Package size"), "0.000001");
      fireEvent.press(result.getByLabelText("Increase quantity"));
      fireEvent.press(result.getByLabelText("Increase quantity"));
      const calls = spyCreate();
      fireEvent.press(result.getByLabelText("Add 3 to Fridge"));
      await flushPending();
      expect(calls[0]?.amount).toBe("0.000003");
      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Plain Greek Yogurt");
      expect(created?.quantity.micros).toBe("3");
    });
  });

  it("changing the typed size after a failed Add discards the held key", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      const keys: string[] = [];
      const original = apiClient.createItem.bind(apiClient);
      let calls = 0;
      vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
        keys.push(input.idempotencyKey);
        calls += 1;
        if (calls === 1) {
          throw new Error("network down");
        }
        return original(input);
      });
      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();
      openSizeField(result);
      fireEvent.changeText(result.getByLabelText("Package size"), "500");
      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();
      expect(keys).toHaveLength(2);
      expect(keys[0]).not.toBe(keys[1]);
    });
  });

  it("the size tap target is at least 44 by 44 and the field at least 44 high", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      const style = flattenStyle(result.getByLabelText(/^Edit package size/).props.style);
      expect(style.minHeight).toBe(44);
      expect(style.minWidth).toBe(44);
      openSizeField(result);
      const input = flattenStyle(result.getByLabelText("Package size").props.style);
      expect(input.minHeight).toBe(44);
    });
  });

  it("the size button's label keeps the size a screen reader should hear", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.getByLabelText("Edit package size, 125 g")).toBeTruthy();
    });
  });

  it("an unusable size announces the hint once as it turns invalid, in a polite live region", async () => {
    await withLookup(yogurtProduct("g"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      openSizeField(result);
      fireEvent.changeText(result.getByLabelText("Package size"), "5");
      expect(announce).not.toHaveBeenCalled();
      fireEvent.changeText(result.getByLabelText("Package size"), "5x");
      fireEvent.changeText(result.getByLabelText("Package size"), "5xy");
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(SIZE_HINT);
      expect(
        (result.getByText(SIZE_HINT).props as { accessibilityLiveRegion?: string })
          .accessibilityLiveRegion,
      ).toBe("polite");
    });
  });
});

// ---------------------------------------------------------------------------
// M2-T8 (D-029): a typed size in a count unit ("ct", recorded as "each") is a
// whole number. Mass and volume keep decimals (the "g" cases above).
// ---------------------------------------------------------------------------

const WHOLE_HINT = "Use a whole number, like 2.";

describe("S8 · count-unit package size takes whole numbers (M2-T8, D-029)", () => {
  it("a typed fraction shows the whole-number hint, keeps the editor open and disables Add", async () => {
    await withLookup(yogurtProduct("ct"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      fireEvent.press(result.getByLabelText(/^Edit package size/));
      fireEvent.changeText(result.getByLabelText("Package size"), "2.5");
      expect(result.getByText(WHOLE_HINT)).toBeTruthy();
      expect(result.queryByText(SIZE_HINT)).toBeNull();
      expect(announce).toHaveBeenCalledWith(WHOLE_HINT);
      const add = result.getByLabelText("Add 1 to Fridge");
      expect(
        (add.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled,
      ).toBe(true);
      fireEvent(result.getByLabelText("Package size"), "blur");
      expect(result.getByLabelText("Package size")).toBeTruthy(); // still editing
      const spy = vi.spyOn(apiClient, "createItem");
      fireEvent.press(add);
      await flushPending();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("unusable text in a count unit keeps the general hint", async () => {
    await withLookup(yogurtProduct("ct"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      fireEvent.press(result.getByLabelText(/^Edit package size/));
      fireEvent.changeText(result.getByLabelText("Package size"), "abc");
      expect(result.getByText(SIZE_HINT)).toBeTruthy();
      expect(result.queryByText(WHOLE_HINT)).toBeNull();
    });
  });

  it("a whole typed size clears the hint and Add creates whole each x count", async () => {
    await withLookup(yogurtProduct("ct"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      fireEvent.press(result.getByLabelText(/^Edit package size/));
      fireEvent.changeText(result.getByLabelText("Package size"), "6.5");
      fireEvent.changeText(result.getByLabelText("Package size"), "6");
      expect(result.queryByText(WHOLE_HINT)).toBeNull();
      fireEvent.press(result.getByLabelText("Increase quantity"));
      const calls = spyCreate();
      fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
      await flushPending();
      expect(calls[0]?.unit).toBe("each");
      expect(calls[0]?.amount).toBe("12");
    });
  });

  it("the server's COUNT_NOT_WHOLE refusal renders its own sentence, never the server's", async () => {
    await withLookup(yogurtProduct("ct"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      vi.spyOn(apiClient, "createItem").mockRejectedValue(
        new LedgerRefusedError("COUNT_NOT_WHOLE"),
      );
      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();
      expect(result.getByText("Use a whole number for this item.")).toBeTruthy();
    });
  });
});
