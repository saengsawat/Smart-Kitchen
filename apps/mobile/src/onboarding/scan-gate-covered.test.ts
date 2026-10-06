/**
 * S7 under a covered onboarding gate (BUG-001 review F2b). Once the root
 * navigator has mounted, `app/_layout.tsx` covers a blocked screen instead
 * of unmounting it, so S7 can be mounted while the gate is still deciding
 * (or has failed closed). While `GateCoveredContext` is `true` it must not
 * touch the camera: no permission status query, no permission request, no
 * live `CameraView` (and so no `onBarcodeScanned`).
 *
 * `expo-camera` resolves to the shared `src/test-support/expo-camera-mock.ts`
 * (vitest alias), whose hooks record the options the screen passes to
 * `useCameraPermissions`, count permission requests and honour `get`.
 * `.test.ts`, not `.test.tsx`, same reason as the other component tests.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { GateCoveredContext } from "./gate-context";
import {
  __getMockCameraPermissionCalls,
  __getMockCameraPermissionRequests,
  __resetMockCameraPermission,
  __setMockCameraPermission,
  __setMockCameraStatusKnown,
  type CameraPermissionResponse,
} from "../test-support/expo-camera-mock";

const UNDETERMINED: CameraPermissionResponse = {
  granted: false,
  canAskAgain: true,
  status: "undetermined",
};
const GRANTED: CameraPermissionResponse = { granted: true, canAskAgain: true, status: "granted" };

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    canGoBack: () => false,
    back: () => {},
  }),
}));

beforeEach(() => {
  __resetMockCameraPermission();
  __setMockCameraPermission(UNDETERMINED);
});

afterEach(() => {
  cleanup();
  __resetMockCameraPermission();
  vi.restoreAllMocks();
});

async function scanTree(covered: boolean): Promise<React.ReactElement> {
  const { default: ScanScreen } = await import("../../app/add/scan");
  return React.createElement(
    GateCoveredContext.Provider,
    { value: covered },
    React.createElement(
      ToastProvider,
      null,
      React.createElement(ScanScreen),
      React.createElement(ToastHost),
    ),
  );
}

async function renderScan(covered: boolean): Promise<ReturnType<typeof render>> {
  const result = render(await scanTree(covered));
  await flushPending();
  return result;
}

function cameraViews(result: ReturnType<typeof render>): number {
  return result.UNSAFE_queryAllByType("CameraView" as unknown as React.ComponentType).length;
}

describe("S7 · under a covered onboarding gate (BUG-001 review F2b)", () => {
  it("makes no camera permission query or request while covered", async () => {
    await renderScan(true);

    const calls = __getMockCameraPermissionCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((o) => o?.get === false)).toBe(true);
    expect(__getMockCameraPermissionRequests()).toBe(0);
  });

  it("makes no permission request while covered even when the status is already known and not granted", async () => {
    __setMockCameraStatusKnown(true);
    await renderScan(true);

    expect(__getMockCameraPermissionRequests()).toBe(0);
  });

  it("renders no live camera (so no barcode handler) while covered, even with permission already granted", async () => {
    __setMockCameraPermission(GRANTED);
    __setMockCameraStatusKnown(true);
    const covered = await renderScan(true);
    expect(cameraViews(covered)).toBe(0);
    cleanup();

    const shown = await renderScan(false);
    expect(cameraViews(shown)).toBe(1);
  });

  it("uncovered, it queries and requests permission as before", async () => {
    await renderScan(false);

    expect(__getMockCameraPermissionCalls().every((o) => o?.get === true)).toBe(true);
    expect(__getMockCameraPermissionRequests()).toBe(1);
  });

  it("on one mounted S7, makes no request while covered and exactly one after the gate lifts", async () => {
    const result = render(await scanTree(true));
    await flushPending();
    expect(__getMockCameraPermissionRequests()).toBe(0);
    expect(cameraViews(result)).toBe(0);

    result.rerender(await scanTree(false));
    await flushPending();

    expect(__getMockCameraPermissionRequests()).toBe(1);
    expect(__getMockCameraPermissionCalls().at(-1)?.get).toBe(true);
  });
});
