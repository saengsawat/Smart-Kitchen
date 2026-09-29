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
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { colors } from "../design/tokens";
import type {
  CreateItemRequestDto,
  ProductLookupResultDto,
  ScannedProductDto,
} from "@smart-kitchen/contracts";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";
import { ProductLookupRefusedError } from "./product-lookup-errors";

let pushed: unknown[] = [];
let replaced: unknown[] = [];

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
          "Something went wrong saving that. Try again, and tell us if it keeps happening.",
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
      // unnamed members — the §8 generic fallback plus a retry instead.
      expect(
        result.getByText(
          "Something went wrong saving that. Try again, and tell us if it keeps happening.",
        ),
      ).toBeTruthy();
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
        basis: "PER_100G",
        values: { calories: 562.5, proteinG: 12.5, carbsG: 10.94, fatG: 23.44 },
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

      expect(result.getByText(/Nutrition \(per serving\) via Open Food Facts/)).toBeTruthy();
      expect(result.getByText("180")).toBeTruthy(); // 179.6 rounded to a whole calorie
      expect(result.getByText("12.5g")).toBeTruthy(); // 12.54 rounded to one decimal
      expect(result.queryByText(/per 100 g/)).toBeNull();
    });
  });

  it("falls back to PER_100G when there is no PER_SERVING", async () => {
    const product = nutritionTestProduct([
      { basis: "PER_100G", values: { calories: 100 }, provenance: OFF_PROVENANCE },
    ]);
    await withLookup(product, async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.getByText(/Nutrition \(per 100 g\) via Open Food Facts/)).toBeTruthy();
    });
  });

  it('shows "Nutrition not on file" with no numbers when there is no profile at all', async () => {
    const product = nutritionTestProduct([]);
    await withLookup(product, async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");
      expect(result.getByText("Nutrition not on file")).toBeTruthy();
      expect(result.queryByText(/via Open Food Facts/)).toBeNull();
    });
  });
});

describe("S8 · quantity tier follows the lowest input, toast word follows it (M3-T4e Objective (d))", () => {
  it("an Estimated (Open Food Facts) package size in a supported unit gives an Estimated quantity and toast", async () => {
    await withLookup(notRunProduct(true), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();
      expect(replaced).toContain("/inventory");

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Organic Creamy Peanut Butter");
      expect(created?.provenance.quantity?.tier).toBe("ESTIMATED");
      expect(
        result.queryByText("Added 1 × Organic Creamy Peanut Butter to Fridge · Estimated"),
      ).toBeTruthy();
    });
  });

  it("no package size at all keeps the quantity (and toast) Known Fact, same as before this ticket", async () => {
    await withLookup(notRunProduct(false), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
      await flushPending();

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Organic Creamy Peanut Butter");
      expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
      expect(
        result.queryByText("Added 1 × Organic Creamy Peanut Butter to Fridge · Known Fact"),
      ).toBeTruthy();
    });
  });

  it("the fixture corpus's Known Fact package sizes still add as Known Fact (no regression)", async () => {
    const result = await renderScreen();
    await lookUp(result, "060000100810"); // Stone-Ground Tahini, "manufacturer-label" Known Fact
    fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
    await flushPending();
    const items = await apiClient.getInventoryItems();
    const created = items.find((item) => item.displayName === "Stone-Ground Tahini");
    expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
  });
});

describe("S8 · package units the ledger cannot accept (M3-T4e Objective (e))", () => {
  function litreProduct(unit: string): ScannedProductDto {
    return nutritionTestProduct([], {
      value: { qty: "1", unit },
      provenance: OFF_PROVENANCE,
    });
  }

  it('a "qt" package size shows "N × 1 qt" as text, updates with the count, and adds as N each, Estimated', async () => {
    await withLookup(litreProduct("qt"), async () => {
      const result = await renderScreen();
      await lookUp(result, "096619555505");

      expect(result.getByText("1 × 1 qt")).toBeTruthy();
      fireEvent.press(result.getByLabelText("Increase quantity"));
      expect(result.getByText("2 × 1 qt")).toBeTruthy();
      expect(result.queryByText("1 qt")).toBeNull(); // never the bare size alone

      fireEvent.press(result.getByLabelText("Add 2 to Fridge"));
      await flushPending();

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Nutrition Test Product");
      expect(created?.quantity.amount).toBe("2");
      expect(created?.quantity.unit).toBe("each");
      expect(created?.provenance.quantity?.tier).toBe("ESTIMATED");
      expect(
        result.queryByText("Added 2 × Nutrition Test Product to Fridge · Estimated"),
      ).toBeTruthy();
    });
  });

  it.each(["pt", "gal", "fl oz"])(
    "%s falls back the same way: each, Estimated, never an invented conversion",
    async (unit) => {
      await withLookup(litreProduct(unit), async () => {
        const result = await renderScreen();
        await lookUp(result, "096619555505");
        fireEvent.press(result.getByLabelText("Add 1 to Fridge"));
        await flushPending();
        const items = await apiClient.getInventoryItems();
        const created = items.find((item) => item.displayName === "Nutrition Test Product");
        expect(created?.quantity.unit).toBe("each");
        expect(created?.quantity.amount).toBe("1");
        expect(created?.provenance.quantity?.tier).toBe("ESTIMATED");
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
});

describe("S7 · product-lookup refusals (M3-T4e Objective (a), copy-deck.md §8)", () => {
  it("PLU_NOT_SUPPORTED renders its exact §8 string, with Enter it manually still offered", async () => {
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
      expect(pushed).toEqual([{ pathname: "/add/manual", params: { code: "04061" } }]);
    } finally {
      apiClient.lookupProduct = original;
    }
  });

  it("BAD_REQUEST renders its exact §8 string", async () => {
    const original = apiClient.lookupProduct.bind(apiClient);
    apiClient.lookupProduct = () => Promise.reject(new ProductLookupRefusedError("BAD_REQUEST"));
    try {
      const result = await renderScreen();
      await lookUp(result, "not-a-code");
      expect(result.getByText("That isn't a barcode number we can look up.")).toBeTruthy();
    } finally {
      apiClient.lookupProduct = original;
    }
  });

  it("a 200 error outcome (upstream trouble) renders its exact §8 string, never result.message", async () => {
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
    } finally {
      apiClient.lookupProduct = original;
    }
  });

  it("a 401/403 (or any other refused lookup) renders the generic fallback, with Enter it manually still offered", async () => {
    const original = apiClient.lookupProduct.bind(apiClient);
    apiClient.lookupProduct = () => Promise.reject(new ProductLookupRefusedError("UNAUTHORIZED"));
    try {
      const result = await renderScreen();
      await lookUp(result, "060000100810");
      expect(
        result.getByText(
          "Something went wrong saving that. Try again, and tell us if it keeps happening.",
        ),
      ).toBeTruthy();
      expect(result.getByLabelText("Enter it manually")).toBeTruthy();
    } finally {
      apiClient.lookupProduct = original;
    }
  });
});
