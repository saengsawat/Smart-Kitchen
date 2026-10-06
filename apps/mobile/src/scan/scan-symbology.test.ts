/**
 * M2-T4c: S7 sends the symbology the camera read with the code. Drives the
 * stand-in `CameraView`'s `onBarcodeScanned` prop with `{ type, data }` and
 * checks what reaches `apiClient.lookupProduct`. The typed fallback sends no
 * hint, and a type outside `SCANNABLE_BARCODE_TYPES_DTO` is dropped rather
 * than sent wrong. `.test.ts`, not `.test.tsx`, like scan-screen.test.ts.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMockCameraPermission,
  type BarcodeScanningResult,
} from "../test-support/expo-camera-mock";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    canGoBack: () => false,
    back: () => {},
  }),
}));

beforeEach(async () => {
  await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
});

afterEach(() => {
  cleanup();
  __resetMockCameraPermission();
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
  await flushPending();
  return result;
}

/** Fires the stand-in CameraView's `onBarcodeScanned` prop, the way expo-camera would. */
async function scan(
  result: ReturnType<typeof render>,
  event: BarcodeScanningResult,
): Promise<void> {
  const cameras = result.UNSAFE_getAllByProps({ facing: "back" });
  const camera = cameras[0];
  if (camera === undefined) throw new Error("no CameraView rendered");
  const handler = camera.props.onBarcodeScanned as (e: BarcodeScanningResult) => void;
  handler(event);
  await flushPending();
}

describe("S7 · the scanned symbology reaches the lookup (M2-T4c)", () => {
  it.each(["upc_a", "upc_e", "ean13", "ean8"] as const)(
    "a %s scan sends that type with the code",
    async (type) => {
      const spy = vi.spyOn(apiClient, "lookupProduct");
      const result = await renderScreen();
      await scan(result, { type, data: "04016007" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("04016007", type);
    },
  );

  it("iOS reports a UPC-A as ean13 with the leading 0 stripped: 12 digits under ean13 send upc_a", async () => {
    const spy = vi.spyOn(apiClient, "lookupProduct");
    const result = await renderScreen();
    await scan(result, { type: "ean13", data: "096619555505" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("096619555505", "upc_a");
  });

  it("a 13-digit ean13 still sends ean13", async () => {
    const spy = vi.spyOn(apiClient, "lookupProduct");
    const result = await renderScreen();
    await scan(result, { type: "ean13", data: "3017620422003" });
    expect(spy).toHaveBeenCalledWith("3017620422003", "ean13");
  });

  it("a type outside the scannable list is dropped: the code is sent with no hint", async () => {
    const spy = vi.spyOn(apiClient, "lookupProduct");
    const result = await renderScreen();
    await scan(result, { type: "code128", data: "04016007" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("04016007", undefined);
  });

  it("the typed fallback sends no type", async () => {
    const spy = vi.spyOn(apiClient, "lookupProduct");
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Barcode number"), "04016007");
    fireEvent.press(result.getByLabelText("Look up code"));
    await flushPending();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("04016007", undefined);
  });
});
