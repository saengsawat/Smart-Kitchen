/**
 * "Is the onboarding gate covering the app right now?" (BUG-001 review F2b).
 *
 * Once the root navigator has mounted, `app/_layout.tsx` never unmounts it:
 * a hold, a failed household read or a pending redirect covers the current
 * screen instead (opaque cover, not tappable, hidden from accessibility,
 * `inert` on web). The screen underneath therefore stays mounted while the
 * gate decides, so a screen whose mount has side effects outside the app
 * must read this and hold them while it is `true`. Today that is S7
 * (`app/add/scan.tsx`): no camera permission query or request, no live
 * camera, no barcode handler, while covered.
 *
 * Defaults to `false` so a screen rendered outside the layout (component
 * tests) behaves as it always has.
 */
import { createContext, useContext } from "react";

export const GateCoveredContext = createContext(false);

export function useGateCovered(): boolean {
  return useContext(GateCoveredContext);
}
