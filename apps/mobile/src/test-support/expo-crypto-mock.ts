/**
 * Minimal `expo-crypto` stand-in for tests (M3-T4a architect ruling,
 * 2026-09-22).
 *
 * `expo-crypto`'s real entry point imports `expo-modules-core`, which
 * references React Native's Babel-injected `__DEV__` global at module-load
 * time, confirmed empirically: a bare `import "expo-crypto"` under vitest
 * throws `ReferenceError: __DEV__ is not defined` before any test runs,
 * the same "real native-module code has no meaning under a plain Node test
 * runner" problem `react-native-mock.ts` documents (see that file's doc
 * comment), just a different symptom (a missing RN-only global rather than
 * unparseable Flow syntax).
 *
 * Real Node has its own cryptographically-secure randomness
 * (`node:crypto`), so unlike the `react-native` stand-in this one is not
 * "fake" in the sense of returning made-up data: it implements the exact
 * two functions `apps/mobile/src/api/idempotency.ts` calls
 * (`getRandomBytes`, `getRandomValues`) against real secure randomness, so a
 * test exercising the "expo-crypto succeeded" branch is exercising a real
 * random source, not a canned one. Scope: only the two functions
 * `idempotency.ts` uses; extend this file (never `react-native-mock.ts`) if
 * a later ticket needs another `expo-crypto` export under test.
 */

import { randomBytes as nodeRandomBytes } from "node:crypto";

export function getRandomBytes(byteCount: number): Uint8Array {
  return new Uint8Array(nodeRandomBytes(byteCount));
}

export function getRandomValues<T extends Uint8Array>(typedArray: T): T {
  const filled = nodeRandomBytes(typedArray.length);
  typedArray.set(filled);
  return typedArray;
}
