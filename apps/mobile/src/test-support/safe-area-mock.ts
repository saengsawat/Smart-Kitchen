/**
 * `react-native-safe-area-context` stand-in for component tests (BUG-003).
 * Tests install it with
 * `vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"))`
 * and drive the bottom inset with `setMockBottomInset` (default 0, the same
 * value the existing per-file mocks return).
 */
let bottom = 0;

/** Test-only: set the bottom safe-area inset; reset to 0 in `afterEach`. */
export function setMockBottomInset(value: number): void {
  bottom = value;
}

export function useSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  return { top: 0, bottom, left: 0, right: 0 };
}
