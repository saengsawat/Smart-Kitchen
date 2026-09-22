/**
 * Reduced-motion hook (M3-T3, tokens.md §6, design-principles P9). S4/S5's
 * press-scale feedback on rows/chips/buttons drops its transform under
 * `prefers-reduced-motion`, the same treatment tokens.md §6 prescribes for
 * the prototype's `:active { transform: scale(...) }` rules: the state
 * change (a row responding to a tap) is kept, only the animated
 * interpolation is dropped.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) {
        setReduced(value);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value: boolean) => {
        setReduced(value);
      },
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/** A small `:active`-style scale, or `undefined` (no transform at all) when motion is reduced. */
export function pressScaleStyle(
  pressed: boolean,
  reducedMotion: boolean,
): { transform: readonly [{ scale: number }] } | undefined {
  if (!pressed || reducedMotion) {
    return undefined;
  }
  return { transform: [{ scale: 0.97 }] };
}
