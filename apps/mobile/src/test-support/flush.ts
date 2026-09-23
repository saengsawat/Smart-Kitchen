/**
 * Flushes pending microtasks/macrotasks inside an `act()` scope (M3-T4a
 * component test support).
 *
 * `@testing-library/react-native`'s own `waitFor` polls `expectation()`
 * inside a single outer `act(async () => { ... })`, which is not enough by
 * itself to make `react-test-renderer` (React 19; the package itself warns
 * it is deprecated) commit an update a screen's `useEffect` triggers
 * asynchronously (a `.then()` callback calling `setState` after this file's
 * `render()` call has already returned): the update is scheduled, but
 * nothing forces the scheduler to run before `waitFor`'s timeout, so
 * `getByText` never finds the post-load content — confirmed empirically
 * while building this ticket's first component tests (see the worker
 * report). Wrapping a handful of real macrotask ticks in an explicit
 * `act(async () => { ... })` reliably unblocks it; this is that wrapper,
 * named for what it does rather than repeating the workaround inline in
 * every test file.
 */

import { act } from "@testing-library/react-native";

/** Waits `ticks` real macrotask turns, inside one `act()` scope, so React commits anything pending. */
export async function flushPending(ticks = 3): Promise<void> {
  await act(async () => {
    for (let i = 0; i < ticks; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
}
