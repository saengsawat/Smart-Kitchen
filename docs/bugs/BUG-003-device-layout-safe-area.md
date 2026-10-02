# BUG-003: Scan screen and list screens collide with the phone's bottom bar (Android)

**Reported:** 2026-10-01 by Andy (PO), second on-device test, Galaxy phone with the Android navigation bar.
**Status:** OPEN, dispatched 2026-10-01 (Sonnet / Sonnet). Three layout findings with one cause: nothing at the bottom of these screens accounts for the bottom safe-area inset or the floating tab bar's height.
**Code at:** main `84ff332`.

## What Andy saw

1. **S7 Scan barcode:** the "Type the barcode instead" box sits under the Android navigation bar; the Look up button is half hidden behind the home control. The camera panel also fills the whole screen, which reads as too large on a tall phone (the viewfinder brackets sit high and the panel below is mostly empty).
2. **S5 Item detail (Golden Sweet Whole Kernel Corn):** the Lots and History sections run under the floating tab bar (Home, Inventory, Menu, Shopping); the last rows cannot be read.
3. **S4 Inventory:** the last group (Freezer, Salmon fillets) is hidden under the tab bar at the end of the scroll.

## Cause

- `apps/mobile/app/add/scan.tsx`: `styles.fallbackSheet` pads with `spacing.md` and never reads `useSafeAreaInsets().bottom`; `styles.camera` is `flex: 1` so the camera takes every pixel between the header and the sheet.
- `apps/mobile/src/navigation/TabBar.tsx` floats at `bottom: 18 + insets.bottom` with `height: 66`, so it occupies about 84 px plus the inset. The scrollable screens pad their content by `spacing.xxl * 2` (64 px): S4 `app/inventory.tsx`, S5 `app/inventory/[itemId].tsx`, S11 `app/shopping.tsx`, S12 `app/profile.tsx`. The last 20 px plus the inset is always under the bar. Home and Menu do not scroll today and are unaffected.

## Fix (the ticket)

- **Tab bar clearance:** `TabBar.tsx` exports one hook (for example `useTabBarClearance()`) that returns the bar's full footprint (its height plus its bottom offset plus the safe-area inset plus one `spacing.lg` of breathing room). Every scrolling screen that shows the bar uses it for `contentContainerStyle.paddingBottom` (S4, S5, S11, S12). Hard-coded `spacing.xxl * 2` paddings go away. Screens that hide the bar (onboarding, Add flow) do not pad for it.
- **S7 sheet:** `fallbackSheet` pads its bottom by `insets.bottom + spacing.md` so the input and Look up clear the navigation bar. The lookup-error box above it keeps its position relative to the sheet.
- **S7 camera size:** keep the prototype's structure (camera panel, hint, sheet) but cap the camera panel so the viewfinder is reachable with one hand: the panel takes at most 55% of the window height (`useWindowDimensions`), the brackets stay centred in the panel, and the hint sits directly under the panel. The sheet keeps its place at the bottom; the gap between hint and sheet is sand (`styles.screen` background), not camera. No change to permissions, scanning, the frame animation or any string.
- **Keyboard:** when the typed-code input is focused on Android the sheet must stay visible (`KeyboardAvoidingView` or equivalent on the sheet only, `behavior` per platform). Verify on the running app in the browser at a phone viewport and note it for the device pass.

## Acceptance criteria

- A component test per padded screen (S4, S5, S11, S12) asserts `contentContainerStyle.paddingBottom` equals the clearance hook's value for a non-zero inset (mock the safe-area provider the way existing tests do).
- A component test for S7 asserts the sheet's bottom padding includes the inset, and that the camera panel's height is capped at 55% of a mocked window height.
- A test that the clearance hook returns the bar height plus offset plus inset plus `spacing.lg` for an inset of 0 and of 34.
- Smoke script (`apps/mobile/scripts/web-demo-smoke.mjs`) still passes.
- All suites green from an empty build state in CI order (install, lint, typecheck, test, format:check, export with `EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1`).

## File scope

`apps/mobile/app/add/scan.tsx` (layout and styles only), `apps/mobile/src/navigation/TabBar.tsx`, `apps/mobile/app/inventory.tsx` (the content padding only; BUG-004 edits `handleConfirm` in the same file in parallel, touch nothing else there), `apps/mobile/app/inventory/[itemId].tsx` (content padding only), `apps/mobile/app/shopping.tsx` (content padding only), `apps/mobile/app/profile.tsx` (content padding only), their tests, `apps/mobile/src/test-support/**` if the safe-area stand-in needs an inset setter, `docs/handoff/BUG-003.worker.md`.

## Out of scope

Any string change; the scan logic; the stepper; the tab bar's design; Home and Menu (no scroll today; they get the hook when they do).

## Still unknown

Whether iOS shows the same (the inset logic is the same; the device pass covers it).
