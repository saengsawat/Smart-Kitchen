/**
 * vitest setup for `apps/mobile` component tests (M3-T4a), wired in from the
 * root `vitest.config.ts` (`test.setupFiles`) alongside a `resolve.alias` for
 * `"react-native"` pointing at `./react-native-mock.ts` (see that file's doc
 * comment for why a stand-in exists at all).
 *
 * The alias alone is not enough. It rewrites `react-native` for code Vite
 * resolves and transforms itself, but `@testing-library/react-native`'s own
 * query helpers (`getByText`, `fireEvent`'s text-input detection) call a bare
 * `require("react-native")` from inside their own (pre-built, externalized)
 * CommonJS output, which Node's native module loader resolves directly,
 * bypassing Vite's resolver entirely. Left alone, that `require` reaches the
 * real `react-native` package and fails to parse (see the mock's doc
 * comment). This patches `Module._load`, the actual hook Node's CJS loader
 * calls for every `require`, so that this one specifier resolves to the same
 * mock module Vite's alias hands out everywhere else — one canonical set of
 * component references, so `getByText`'s `element.type === Text` identity
 * check succeeds.
 *
 * Scoped to the exact string "react-native": every other `require` call
 * (including "react-native-safe-area-context", "expo-router", …) is passed
 * through to the original loader unchanged.
 */

import Module from "node:module";
import * as reactNativeMock from "./react-native-mock";

/**
 * The one static `Module` member this file needs, typed narrowly (Node's own
 * `@types/node` declares `Module._load` as an internal, undocumented API
 * with no public type, hence the local shape rather than `any`).
 */
interface ModuleWithLoad {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const moduleWithLoad = Module as unknown as ModuleWithLoad;
const originalLoad = moduleWithLoad._load.bind(moduleWithLoad);

moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean,
): unknown {
  if (request === "react-native") {
    return reactNativeMock;
  }
  return originalLoad(request, parent, isMain);
};

// react-test-renderer (react-native's usual test host) checks this flag and
// warns "not configured to support act(...)" otherwise; @testing-library/
// react-native wraps every interaction in `act` but does not set the flag.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
