# BUG-004: Confirm on an AI proposal throws an uncaught promise rejection over the API

**Reported:** 2026-10-01 by Andy (PO), second on-device test, real mode against the seeded practice database.
**Status:** OPEN, dispatched 2026-10-01 (Sonnet / Sonnet). The crash guard is this ticket; making Confirm actually work over the API is M2-T5 in BACKLOG.md.
**Code at:** main `84ff332`.

## What Andy saw

On S4, the "Needs your confirmation" tray lists Strawberries and Mushrooms (seeded receipt reads). Tapping **Confirm** on either shows the Expo error toast "Uncaught (in promise, id: 3) Error: Fi..." and nothing else happens. The toast then stays on top of every screen until dismissed.

## Cause

`HttpApiClient.confirmAiProposal` (`apps/mobile/src/api/client.ts`) still delegates to the internal fixture client because no server endpoint exists (recorded as a pre-existing gap in the M3-T4d worker report). The fixture client's `requireItem` does not know the server's item ids, so the call rejects with "FixtureApiClient: unknown item ...". `handleConfirm` in `apps/mobile/app/inventory.tsx` awaits it with no catch, so the rejection is unhandled. Demo mode does not reproduce (the fixture ids match).

## Fix (the ticket)

- `handleConfirm` catches a failed confirm and shows the generic ledger write fallback (`GENERIC_LEDGER_ERROR_MESSAGE` from `src/inventory/errors.ts`, copy-deck §8) in the existing toast; the tray row stays, nothing is marked confirmed, `load()` is not called on failure. No new string.
- `HttpApiClient.confirmAiProposal` stops pretending: over HTTP it rejects with a typed error (`ApiError` with a dedicated code such as `NOT_AVAILABLE`), never the fixture's "unknown item" message. The screen treats it like any other write failure. M2-T5 replaces this with the real call.
- Any other `await apiClient.*` on S4 that has no catch gets the same treatment (audit the file; report what was found).

## Acceptance criteria

- Component test: Confirm on a tray row whose confirm rejects shows the write fallback, keeps the row in the tray, does not call `load()` again, and surfaces no unhandled rejection (assert with a `process.on("unhandledRejection")` guard or vitest's unhandled-error reporting).
- Component test: Confirm on a tray row whose confirm resolves still toasts "{name} confirmed" and reloads (the existing behaviour, pinned).
- Client test: `HttpApiClient.confirmAiProposal` rejects with the typed error and never reaches the fixture delegate.
- All suites green from an empty build state in CI order.

## File scope

`apps/mobile/app/inventory.tsx` (`handleConfirm` and the audit only; BUG-003 edits this file's content padding in parallel, touch nothing else there), `apps/mobile/app/inventory/[itemId].tsx` (`handleConfirm` only; widened 2026-10-01 after the worker found the same un-caught await on S5), `apps/mobile/src/api/client.ts` (`confirmAiProposal` in `HttpApiClient` and the stale constructor comment), their tests (including `item-detail-screen.test.ts`, whose S5 Confirm test only passed through the fixture fall-through), `docs/handoff/BUG-004.worker.md`.

## Out of scope

The server endpoint and the real confirm (M2-T5); the fixture client; any other screen.
