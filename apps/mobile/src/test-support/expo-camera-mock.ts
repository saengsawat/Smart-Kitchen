/**
 * Minimal `expo-camera` stand-in for component tests under vitest (M3-T4b),
 * the same pattern `expo-crypto-mock.ts` established: real native-module code
 * has no meaning under a plain Node test runner.
 *
 * Confirmed empirically: `await import("expo-camera")` under vitest throws
 * `ReferenceError: __DEV__ is not defined` from `expo`'s own
 * `async-require/setup.ts` (a transitive import expo-camera's entry point
 * pulls in), before a single test runs — the same "no RN-only globals under
 * Node" failure class `react-native-mock.ts`/`expo-crypto-mock.ts` document,
 * just reached through `expo-camera`'s own dependency graph rather than
 * `expo-modules-core` directly.
 *
 * Scope: only `CameraView` and `useCameraPermissions`, the two exports
 * `app/add/scan.tsx` uses. `BarcodeScanningResult`/`CameraPermissionResponse`
 * mirror the real module's shape closely enough for this app's own code to
 * type-check and behave the same against either the real module (on device)
 * or this stand-in (under vitest); they are not a claim of exhaustive parity
 * with expo-camera's full API surface.
 *
 * `CameraView` renders as a plain host element, the same
 * `React.createElement(tag, ...)` convention `react-native-mock.ts` uses, so
 * `@testing-library/react-native`'s `getByTestId`/`.toJSON()` see an
 * ordinary host node. It is never driven by a simulated barcode event in
 * this ticket's own component tests (BACKLOG.md M3-T4b: "worker verifies via
 * the typed fallback where no device is available and says so") — the
 * `onBarcodeScanned` prop exists so `app/add/scan.tsx` type-checks and
 * behaves identically on a real device, not because a test fires it.
 *
 * Permission state is controlled by {@link __setMockCameraPermission} (set
 * before rendering a screen under test, mirroring how other test-support
 * modules are steered — e.g. `globalThis.fetch` in `item-detail-screen.test.ts`)
 * and reset by {@link __resetMockCameraPermission}, defaulting to granted so a
 * test that does not care about the permission state renders straight into
 * the live-camera path.
 */

import * as React from "react";

export type CameraPermissionStatus = "granted" | "denied" | "undetermined";

export interface CameraPermissionResponse {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly status: CameraPermissionStatus;
}

const GRANTED: CameraPermissionResponse = {
  granted: true,
  canAskAgain: true,
  status: "granted",
};

let mockPermission: CameraPermissionResponse = GRANTED;

/** Test-only: steer the next `useCameraPermissions()` render (call before `render(...)`). */
export function __setMockCameraPermission(next: CameraPermissionResponse): void {
  mockPermission = next;
}

/** Test-only: restore the default (granted) permission state, e.g. in `afterEach`. */
export function __resetMockCameraPermission(): void {
  mockPermission = GRANTED;
}

/** Mirrors `expo-camera`'s `useCameraPermissions(): [CameraPermissionResponse, () => Promise<CameraPermissionResponse>]`. */
export function useCameraPermissions(): [
  CameraPermissionResponse,
  () => Promise<CameraPermissionResponse>,
] {
  const [permission, setPermission] = React.useState(mockPermission);
  const request = React.useCallback(() => {
    setPermission(mockPermission);
    return Promise.resolve(mockPermission);
  }, []);
  return [permission, request];
}

export interface BarcodeScanningResult {
  readonly type: string;
  readonly data: string;
}

export interface CameraViewProps {
  readonly style?: unknown;
  readonly facing?: "back" | "front";
  readonly barcodeScannerSettings?: { readonly barcodeTypes: readonly string[] };
  readonly onBarcodeScanned?: (result: BarcodeScanningResult) => void;
  readonly children?: React.ReactNode;
  readonly [key: string]: unknown;
}

const CameraViewImpl = React.forwardRef<unknown, CameraViewProps>((props, ref) => {
  const children = props.children as React.ReactNode;
  const rest: Record<string, unknown> = { ...props };
  delete rest.children;
  return React.createElement("CameraView", { ...rest, ref }, children);
});
CameraViewImpl.displayName = "CameraView";

export const CameraView = CameraViewImpl;
