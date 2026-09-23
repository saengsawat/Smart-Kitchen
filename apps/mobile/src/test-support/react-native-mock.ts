/**
 * Minimal `react-native` stand-in for component tests under vitest (M3-T4a).
 *
 * `react-native`'s real npm package ships raw Flow source (including the
 * newer `component Foo(...) {}` declaration syntax) as its entry point, with
 * no precompiled plain-JS build for a non-Metro consumer to load. vitest's
 * transform (esbuild/Rolldown, configured for TypeScript, not Flow) cannot
 * parse it — confirmed empirically: `import { View } from "react-native"`
 * under vitest fails with "Flow is not supported" before a single test runs.
 * Jest solves this with a Babel transform over `node_modules` (the
 * `react-native`/`jest-expo` preset); adding an equivalent Babel/Flow pipeline
 * to vitest is exactly the kind of further package/preset BACKLOG.md's
 * M3-T4a Objective (e) says to keep minimal and escalate on rather than add
 * silently, so this file takes the other path: replace the module entirely
 * for tests with host-agnostic stand-ins built from nothing but `react`.
 *
 * Every primitive here renders as a plain string-tagged host element
 * (`React.createElement("View", ...)`), which is exactly what
 * `react-test-renderer` (and `@testing-library/react-native`'s `getByTestId`/
 * `fireEvent`, which check `typeof element.type === "string"`) expect a host
 * component to look like — so the query/event helpers that do not need to
 * recognise the *real* `Text`/`TextInput` (`getByTestId`, `fireEvent.press`,
 * `.toJSON()`) work unmodified. `getByText` also works: it destructures
 * `Text` from `require("react-native")` at call time (see this module's
 * companion `vitest-setup.ts`), which resolves to this file's own `Text`
 * export, the same reference the component tree was built from.
 *
 * Scope: only the primitives `apps/mobile`'s screens/components actually
 * import from `react-native` today. Add to this list only when a new screen
 * needs one; do not pre-build the rest of the surface speculatively.
 */

import * as React from "react";

type HostProps = React.PropsWithChildren<Record<string, unknown>>;

function hostComponent(tag: string): React.ForwardRefExoticComponent<HostProps> {
  const component = React.forwardRef<unknown, HostProps>((props, ref) => {
    // `HostProps`'s index signature widens even the declared `children` to
    // `unknown` on access; the cast is exactly as safe as the real `View`'s
    // own `children?: ReactNode` prop, restated because the index signature
    // (needed so arbitrary RN props like `style`/`onPress` pass through)
    // erases that narrower type.
    const children = props.children as React.ReactNode;
    const rest: Record<string, unknown> = { ...props };
    delete rest.children;
    return React.createElement(tag, { ...rest, ref }, children);
  });
  component.displayName = tag;
  return component;
}

export const View = hostComponent("View");
export const Text = hostComponent("Text");
export const Pressable = hostComponent("Pressable");
export const ScrollView = hostComponent("ScrollView");
export const TextInput = hostComponent("TextInput");

export const StyleSheet = {
  // The real StyleSheet.create is an identity function at the type level
  // (it exists to give style objects a stable id for the native bridge);
  // returning the input unchanged is faithful enough for a test renderer
  // that never touches native styling.
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
};

/**
 * Minimal `Linking` stand-in (M3-T4b, S7's permission-denied "Open Settings"
 * action): the real module opens the OS settings app, which has no meaning
 * under a test runner; a resolved no-op is faithful enough for a screen that
 * only calls it fire-and-forget on a button press.
 */
export const Linking = {
  openSettings(): Promise<void> {
    return Promise.resolve();
  },
};

export const AccessibilityInfo = {
  announceForAccessibility(message: string): void {
    // No-op: the real module speaks to the native accessibility bridge,
    // which does not exist under vitest. Screens call this fire-and-forget.
    void message;
  },
  // `useReducedMotion` (src/inventory/motion.ts) awaits this and subscribes
  // to change events; a test environment has no real reduced-motion
  // setting, so this always resolves "not reduced" and the subscription is
  // a no-op that never fires.
  isReduceMotionEnabled(): Promise<boolean> {
    return Promise.resolve(false);
  },
  addEventListener(
    eventName: string,
    handler: (...args: unknown[]) => void,
  ): { remove: () => void } {
    void eventName;
    void handler;
    return { remove: () => {} };
  },
};
