/**
 * S7 under a covered onboarding gate (BUG-001 review F2b). Once the root
 * navigator has mounted, `app/_layout.tsx` covers a blocked screen instead
 * of unmounting it, so S7 can be mounted while the gate is still deciding
 * (or has failed closed). While `GateCoveredContext` is `true` it must not
 * touch the camera: no permission status query, no permission request, no
 * live `CameraView` (and so no `onBarcodeScanned`).
 *
 * `expo-camera` is mocked here, not through the shared
 * `src/test-support/expo-camera-mock.ts`, because these tests need to see
 * the options the screen passes to `useCameraPermissions` and count
 * permission requests, which the shared mock does not expose.
 * `.test.ts`, not `.test.tsx`, same reason as the other component tests.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { GateCoveredContext } from "./gate-context";

interface MockPermission {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly status: string;
}

const UNDETERMINED: MockPermission = { granted: false, canAskAgain: true, status: "undetermined" };
const GRANTED: MockPermission = { granted: true, canAskAgain: true, status: "granted" };

let mockPermission: MockPermission = UNDETERMINED;
let permissionOptions: Array<{ get?: boolean } | undefined> = [];
let permissionRequests = 0;
/**
 * The real hook keeps a status it already read: a screen that was shown,
 * then covered (a later navigation's hold or failed read), still holds a
 * known permission. `true` models that; `false` models a cold mount under
 * the cover, where `get: false` means it is never read.
 */
let statusKnownBeforeCover = false;

vi.mock("expo-camera", () => ({
  useCameraPermissions: (options?: { get?: boolean }) => {
    permissionOptions.push(options);
    const status = options?.get === false && !statusKnownBeforeCover ? null : mockPermission;
    return [
      status,
      () => {
        permissionRequests += 1;
        return Promise.resolve(mockPermission);
      },
    ];
  },
  CameraView: (props: Record<string, unknown>) => React.createElement("CameraView", props),
}));

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    canGoBack: () => false,
    back: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  mockPermission = UNDETERMINED;
  permissionOptions = [];
  permissionRequests = 0;
  statusKnownBeforeCover = false;
  vi.restoreAllMocks();
});

async function renderScan(covered: boolean): Promise<ReturnType<typeof render>> {
  const { default: ScanScreen } = await import("../../app/add/scan");
  const result = render(
    React.createElement(
      GateCoveredContext.Provider,
      { value: covered },
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ScanScreen),
        React.createElement(ToastHost),
      ),
    ),
  );
  await flushPending();
  return result;
}

function cameraViews(result: ReturnType<typeof render>): number {
  return result.UNSAFE_queryAllByType("CameraView" as unknown as React.ComponentType).length;
}

describe("S7 · under a covered onboarding gate (BUG-001 review F2b)", () => {
  it("makes no camera permission query or request while covered", async () => {
    await renderScan(true);

    expect(permissionOptions.length).toBeGreaterThan(0);
    expect(permissionOptions.every((o) => o?.get === false)).toBe(true);
    expect(permissionRequests).toBe(0);
  });

  it("makes no permission request while covered even when the status is already known and not granted", async () => {
    statusKnownBeforeCover = true;
    await renderScan(true);

    expect(permissionRequests).toBe(0);
  });

  it("renders no live camera (so no barcode handler) while covered, even with permission already granted", async () => {
    mockPermission = GRANTED;
    statusKnownBeforeCover = true;
    const covered = await renderScan(true);
    expect(cameraViews(covered)).toBe(0);
    cleanup();

    const shown = await renderScan(false);
    expect(cameraViews(shown)).toBe(1);
  });

  it("uncovered, it queries and requests permission as before", async () => {
    await renderScan(false);

    expect(permissionOptions.every((o) => o?.get === true)).toBe(true);
    expect(permissionRequests).toBe(1);
  });
});
