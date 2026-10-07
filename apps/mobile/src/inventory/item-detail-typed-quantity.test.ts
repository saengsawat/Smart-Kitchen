/**
 * M3-T7 (a): S5's typed amount field, against the default fixture
 * `ApiClient` (no `EXPO_PUBLIC_API_URL`): typing replaces the draft exactly,
 * the stepper steps from the typed value, an unparsable entry shows the hint
 * and disables Save, and Save appends one correction of the exact delta.
 * `.test.ts` with `React.createElement`, like its siblings.
 *
 * M2-T8 (D-029): count units take whole numbers. The M3-T7 decimal cases
 * moved from eggs (a count item) to chicken breast (lb), where decimals still
 * hold; the count rules (step by 1, step from a fraction to the next whole
 * number, the whole-number hint, the server refusal's sentence) are on eggs.
 */
import React from "react";
import { ledgerRowsOf } from "./history";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityInfo } from "react-native";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";
import { flushPending } from "../test-support/flush";
import { LedgerRefusedError } from "./errors";
import { ToastHost, ToastProvider } from "./Toast";

const CHICKEN = "fixture-item-chicken"; // fixture quantity: 1.25 lb
const EGGS = "fixture-item-eggs"; // fixture quantity: 8 count (lot label "carton of 12")
const HINT = "Enter a number, like 2 or 0.5.";
const WHOLE_HINT = "Use a whole number, like 2.";
const COUNT_REFUSAL = "Use a whole number for this item.";

const route = vi.hoisted(() => ({ itemId: "fixture-item-chicken" }));

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
  useLocalSearchParams: () => ({ itemId: route.itemId }),
}));

beforeEach(async () => {
  await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderScreen(itemId: string): Promise<ReturnType<typeof render>> {
  route.itemId = itemId;
  const { default: Screen } = await import("../../app/inventory/[itemId]");
  const result = render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(Screen),
      React.createElement(ToastHost),
    ),
  );
  await flushPending();
  return result;
}

function isDisabled(node: { props: unknown }): boolean {
  const props = node.props as { disabled?: boolean; accessibilityState?: { disabled?: boolean } };
  return props.disabled === true || props.accessibilityState?.disabled === true;
}

/**
 * S5's big quantity header: the text node right before "on hand · {location}"
 * in the header block. Located by structure because the lot row can render
 * the same "1.5 lb" text, so a bare `getByText` would be ambiguous.
 */
function headerText(result: ReturnType<typeof render>): string {
  const sub = result.getByText(/^on hand ·/);
  const block = sub.parent?.parent;
  const children = (block?.props as { children?: unknown }).children;
  const first = Array.isArray(children)
    ? (children[0] as { props?: { children?: unknown } })
    : undefined;
  const text = first?.props?.children;
  return Array.isArray(text) ? text.join("") : String(text);
}

function fieldValue(result: ReturnType<typeof render>): string {
  return (result.getByLabelText("Quantity amount").props as { value: string }).value;
}

describe("S5 · typed amount (M3-T7 a), a mass unit", () => {
  it("shows the current amount in a decimal field, with Save disabled at baseline", async () => {
    const result = await renderScreen(CHICKEN);
    expect(fieldValue(result)).toBe("1.25");
    expect(
      (result.getByLabelText("Quantity amount").props as { keyboardType?: string }).keyboardType,
    ).toBe("decimal-pad");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);
    expect(result.queryByText(HINT)).toBeNull();
  });

  it("typing 1.5 and saving appends a +0.25 correction (mass units keep decimals)", async () => {
    const result = await renderScreen(CHICKEN);
    const spy = vi.spyOn(apiClient, "correctQuantity");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "1.5");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();

    expect(spy).toHaveBeenCalledWith(CHICKEN, "1500000");
    const detail = await apiClient.getInventoryItem(CHICKEN);
    const last = ledgerRowsOf(detail?.history ?? []).at(-1);
    expect(last?.deltaMicros).toBe("250000");
    expect(detail?.summary.quantity.micros).toBe("1500000");
    expect(headerText(result)).toBe("1.5 lb");
    expect(fieldValue(result)).toBe("1.5");
  });

  it("typing 2.5 appends the exact +1.25 delta and the header reads 2.5 lb", async () => {
    const result = await renderScreen(CHICKEN);
    expect(headerText(result)).toBe("1.25 lb");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "2.5");
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    const detail = await apiClient.getInventoryItem(CHICKEN);
    const last = ledgerRowsOf(detail?.history ?? []).at(-1);
    expect(last?.deltaMicros).toBe("1250000");
    expect(headerText(result)).toBe("2.5 lb");
  });

  it("typing 0.000001 sends exactly one micro, never a rounded value", async () => {
    const result = await renderScreen(CHICKEN);
    const spy = vi.spyOn(apiClient, "correctQuantity");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "0.000001");
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    expect(spy).toHaveBeenCalledWith(CHICKEN, "1");
  });

  it.each(["abc", "", "1.1234567", "-2", "1e3", "1,5", "1.2.3", "100000001"])(
    "%j shows the hint and disables Save",
    async (text) => {
      const result = await renderScreen(CHICKEN);
      const spy = vi.spyOn(apiClient, "correctQuantity");
      fireEvent.changeText(result.getByLabelText("Quantity amount"), text);
      expect(result.getByText(HINT)).toBeTruthy();
      expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);
      fireEvent.press(result.getByLabelText("Save correction"));
      await flushPending();
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("accepts the domain maximum, 100000000", async () => {
    const result = await renderScreen(CHICKEN);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "100000000");
    expect(result.queryByText(HINT)).toBeNull();
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
  });

  it("the hint clears and Save re-enables once the text parses again", async () => {
    const result = await renderScreen(CHICKEN);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "abc");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "7.5");
    expect(result.queryByText(HINT)).toBeNull();
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
  });

  it("typing the current amount back leaves Save disabled", async () => {
    const result = await renderScreen(CHICKEN);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "1.250");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);
  });

  it("the stepper keeps stepping 0.25 from the typed value", async () => {
    const result = await renderScreen(CHICKEN);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "250");
    fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
    expect(fieldValue(result)).toBe("250.25");
    fireEvent.press(result.getByLabelText("Decrease quantity by 0.25"));
    fireEvent.press(result.getByLabelText("Decrease quantity by 0.25"));
    expect(fieldValue(result)).toBe("249.75");
  });

  it("the stepper never goes below zero or above the maximum", async () => {
    const result = await renderScreen(CHICKEN);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "0.1");
    fireEvent.press(result.getByLabelText("Decrease quantity by 0.25"));
    expect(fieldValue(result)).toBe("0");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "100000000");
    fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
    expect(fieldValue(result)).toBe("100000000");
  });

  it("stepping from unparsable text steps from the last usable amount and clears the hint", async () => {
    const result = await renderScreen(CHICKEN);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "abc");
    fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
    expect(fieldValue(result)).toBe("1.5");
    expect(result.queryByText(HINT)).toBeNull();
  });

  it("1.005 reaches the correction as exactly 1005000 micros (a float path would send 1004999)", async () => {
    const result = await renderScreen(CHICKEN);
    const spy = vi.spyOn(apiClient, "correctQuantity");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "1.005");
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    expect(spy).toHaveBeenCalledWith(CHICKEN, "1005000");
  });

  it("Save is disabled by the invalid text itself, even when the last usable draft differs from the current amount", async () => {
    const result = await renderScreen(CHICKEN);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "7.5");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "7.5x");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);
  });

  it("the amount field is at least 44 high", async () => {
    const result = await renderScreen(CHICKEN);
    const style = result.getByLabelText("Quantity amount").props.style as unknown;
    const flat: Record<string, unknown> = {};
    for (const entry of Array.isArray(style) ? style : [style]) {
      if (entry && typeof entry === "object") Object.assign(flat, entry);
    }
    expect(flat.minHeight).toBe(44);
  });

  it("an unusable amount announces the hint once as it turns invalid, in a polite live region", async () => {
    const result = await renderScreen(CHICKEN);
    const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "7");
    expect(announce).not.toHaveBeenCalled();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "7x");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "7xy");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(HINT);
    expect(
      (result.getByText(HINT).props as { accessibilityLiveRegion?: string })
        .accessibilityLiveRegion,
    ).toBe("polite");
  });
});

describe("S5 · count units take whole numbers (M2-T8, D-029)", () => {
  it("the stepper steps by 1 and says so", async () => {
    const result = await renderScreen(EGGS);
    expect(fieldValue(result)).toBe("8");
    expect(result.queryByLabelText("Increase quantity by 0.25")).toBeNull();
    fireEvent.press(result.getByLabelText("Increase quantity by 1"));
    expect(fieldValue(result)).toBe("9");
    fireEvent.press(result.getByLabelText("Decrease quantity by 1"));
    fireEvent.press(result.getByLabelText("Decrease quantity by 1"));
    expect(fieldValue(result)).toBe("7");
  });

  it("a typed fraction shows the whole-number hint, disables Save, and sends nothing", async () => {
    const result = await renderScreen(EGGS);
    const spy = vi.spyOn(apiClient, "correctQuantity");
    const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "8.5");
    expect(result.getByText(WHOLE_HINT)).toBeTruthy();
    expect(result.queryByText(HINT)).toBeNull();
    expect(announce).toHaveBeenCalledWith(WHOLE_HINT);
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    expect(spy).not.toHaveBeenCalled();
  });

  it("a whole number clears the hint and saves exactly", async () => {
    const result = await renderScreen(EGGS);
    const spy = vi.spyOn(apiClient, "correctQuantity");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "8.5");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "10.000");
    expect(result.queryByText(WHOLE_HINT)).toBeNull();
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    expect(spy).toHaveBeenCalledWith(EGGS, "10000000");
  });

  it("unusable text on a count item keeps the general hint", async () => {
    const result = await renderScreen(EGGS);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "abc");
    expect(result.getByText(HINT)).toBeTruthy();
    expect(result.queryByText(WHOLE_HINT)).toBeNull();
  });

  it("from a typed 12.5 the stepper goes down to 12 or up to 13 and the hint clears", async () => {
    const result = await renderScreen(EGGS);
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "12.5");
    fireEvent.press(result.getByLabelText("Decrease quantity by 1"));
    expect(fieldValue(result)).toBe("12");
    expect(result.queryByText(WHOLE_HINT)).toBeNull();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "12.5");
    fireEvent.press(result.getByLabelText("Increase quantity by 1"));
    expect(fieldValue(result)).toBe("13");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
  });

  it("a fractional balance from history reads as it is, and the stepper takes it to a whole number", async () => {
    // History written before D-029: the fixture client records any exact amount.
    await apiClient.correctQuantity(EGGS, "12500000");
    const result = await renderScreen(EGGS);
    expect(fieldValue(result)).toBe("12.5");
    expect(result.getByText("12.5 of 12")).toBeTruthy();
    expect(result.queryByText(WHOLE_HINT)).toBeNull();
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);

    fireEvent.press(result.getByLabelText("Decrease quantity by 1"));
    expect(fieldValue(result)).toBe("12");
    const spy = vi.spyOn(apiClient, "correctQuantity");
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    expect(spy).toHaveBeenCalledWith(EGGS, "12000000");
  });

  it("the server's COUNT_NOT_WHOLE refusal on a correction renders its own sentence", async () => {
    const result = await renderScreen(EGGS);
    vi.spyOn(apiClient, "correctQuantity").mockRejectedValue(
      new LedgerRefusedError("COUNT_NOT_WHOLE"),
    );
    fireEvent.press(result.getByLabelText("Increase quantity by 1"));
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    expect(result.getByText(COUNT_REFUSAL)).toBeTruthy();
  });

  it("the server's COUNT_NOT_WHOLE refusal on a removal renders its own sentence", async () => {
    const result = await renderScreen(EGGS);
    const remove = vi
      .spyOn(apiClient, "removeQuantity")
      .mockRejectedValue(new LedgerRefusedError("COUNT_NOT_WHOLE"));
    fireEvent.press(result.getByLabelText("Discard"));
    fireEvent.press(result.getByLabelText("Spoiled"));
    await flushPending();
    // The removal sends no amount at all: the whole balance, which D-029
    // always allows, so this refusal is a server-side guard only.
    expect(remove).toHaveBeenCalledWith(EGGS, "DISCARD", "Spoiled");
    expect(result.getByText(COUNT_REFUSAL)).toBeTruthy();
  });
});
