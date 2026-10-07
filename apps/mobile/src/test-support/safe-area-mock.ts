/**
 * `react-native-safe-area-context` stand-in for component tests (BUG-003).
 * Tests install it with
 * `vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"))`
 * and drive the bottom inset with `setMockBottomInset` and the top inset with
 * `setMockTopInset` (both default 0, the same value the existing per-file
 * mocks return).
 */
let top = 0;
let bottom = 0;

/** Test-only: set the bottom safe-area inset; reset to 0 in `afterEach`. */
export function setMockBottomInset(value: number): void {
  bottom = value;
}

/** Test-only (M3-T10): set the top safe-area inset; reset with `resetMockInsets`. */
export function setMockTopInset(value: number): void {
  top = value;
}

/** Test-only: put both insets back to 0. */
export function resetMockInsets(): void {
  top = 0;
  bottom = 0;
}

export function useSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  return { top, bottom, left: 0, right: 0 };
}
