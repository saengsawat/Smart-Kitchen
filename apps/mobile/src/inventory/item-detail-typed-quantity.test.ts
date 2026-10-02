/**
 * M3-T7 (a): S5's typed amount field, against the default fixture
 * `ApiClient` (no `EXPO_PUBLIC_API_URL`): typing replaces the draft exactly,
 * the stepper steps from the typed value, an unparsable entry shows the hint
 * and disables Save, and Save appends one correction of the exact delta.
 * `.test.ts` with `React.createElement`, like its siblings.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "./Toast";

const EGGS = "fixture-item-eggs"; // fixture quantity: 8 count (lot label "carton of 12")
const HINT = "Enter a number, like 2 or 0.5.";

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
  useLocalSearchParams: () => ({ itemId: "fixture-item-eggs" }),
}));

beforeEach(async () => {
  await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
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

function fieldValue(result: ReturnType<typeof render>): string {
  return (result.getByLabelText("Quantity amount").props as { value: string }).value;
}

describe("S5 · typed amount (M3-T7 a)", () => {
  it("shows the current amount in a decimal field, with Save disabled at baseline", async () => {
    const result = await renderScreen();
    expect(fieldValue(result)).toBe("8");
    expect(
      (result.getByLabelText("Quantity amount").props as { keyboardType?: string }).keyboardType,
    ).toBe("decimal-pad");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);
    expect(result.queryByText(HINT)).toBeNull();
  });

  it("typing 8.25 and saving appends a +0.25 correction (count units accept decimals)", async () => {
    const result = await renderScreen();
    const spy = vi.spyOn(apiClient, "correctQuantity");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "8.25");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();

    expect(spy).toHaveBeenCalledWith(EGGS, "8250000");
    const detail = await apiClient.getInventoryItem(EGGS);
    const last = detail?.history[detail.history.length - 1];
    expect(last?.deltaMicros).toBe("250000");
    expect(detail?.summary.quantity.micros).toBe("8250000");
    expect(result.getByText("8.25 of 12")).toBeTruthy();
    expect(fieldValue(result)).toBe("8.25");
  });

  it("typing 9.25 appends the exact +1.25 delta and the header reads 9.25", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "9.25");
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    const detail = await apiClient.getInventoryItem(EGGS);
    const last = detail?.history[detail.history.length - 1];
    expect(last?.deltaMicros).toBe("1250000");
    expect(result.getByText("9.25 of 12")).toBeTruthy();
  });

  it("typing 0.000001 sends exactly one micro, never a rounded value", async () => {
    const result = await renderScreen();
    const spy = vi.spyOn(apiClient, "correctQuantity");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "0.000001");
    fireEvent.press(result.getByLabelText("Save correction"));
    await flushPending();
    expect(spy).toHaveBeenCalledWith(EGGS, "1");
  });

  it.each(["abc", "", "1.1234567", "-2", "1e3", "1,5", "1.2.3", "100000001"])(
    "%j shows the hint and disables Save",
    async (text) => {
      const result = await renderScreen();
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
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "100000000");
    expect(result.queryByText(HINT)).toBeNull();
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
  });

  it("the hint clears and Save re-enables once the text parses again", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "abc");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "7.5");
    expect(result.queryByText(HINT)).toBeNull();
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(false);
  });

  it("typing the current amount back leaves Save disabled", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "8.000");
    expect(isDisabled(result.getByLabelText("Save correction"))).toBe(true);
  });

  it("the stepper keeps stepping 0.25 from the typed value", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "250");
    fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
    expect(fieldValue(result)).toBe("250.25");
    fireEvent.press(result.getByLabelText("Decrease quantity by 0.25"));
    fireEvent.press(result.getByLabelText("Decrease quantity by 0.25"));
    expect(fieldValue(result)).toBe("249.75");
  });

  it("the stepper never goes below zero or above the maximum", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "0.1");
    fireEvent.press(result.getByLabelText("Decrease quantity by 0.25"));
    expect(fieldValue(result)).toBe("0");
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "100000000");
    fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
    expect(fieldValue(result)).toBe("100000000");
  });

  it("stepping from unparsable text steps from the last usable amount and clears the hint", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Quantity amount"), "abc");
    fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
    expect(fieldValue(result)).toBe("8.25");
    expect(result.queryByText(HINT)).toBeNull();
  });
});
