# BUG-007: Home's header avatar is clipped at the top of the screen

**Reported:** 2026-10-06 by Andy (PO), phone screenshot of the Home tab, Android, Expo Go.
**Status:** OPEN. Cause not yet investigated.

## What Andy saw

A solid dark circle in the top right corner of Home, cut off by the top edge of the screen. It is probably the header avatar (M3-T6 follow-up: initials once Home reads identity) drawn under the status bar. The other tabs place their headers below the status bar.

## Likely cause (unconfirmed)

The Home placeholder doesn't apply the top safe-area inset that BUG-003 added elsewhere (`docs/bugs/BUG-003-device-layout-safe-area.md`, tokens.md §8).

## Next step

A small Sonnet fix. Confirm which element it is, apply the same inset as the other tabs, and add a component test that asserts the inset. Home stays a placeholder (OQ-D9 holds the dashboard).

## Not a bug (noted from the same screenshots)

The floating gear button on every screen is Expo Go's own dev-menu button, not part of the app. It isn't in a real build.
