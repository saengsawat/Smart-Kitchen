# BUG-006: A checked shopping row shows "0 lb"

**Reported:** 2026-10-06 by Andy (PO), phone screenshot of S11 (Shopping), Android, Expo Go.
**Status:** FIXED 2026-10-07 (`c047edf`, review PASS, Opus, architect code pass clean). A row whose PURCHASE has landed now shows the bought amount, read from the ledger. Handoff: `docs/handoff/BUG-006.{worker,review}.md`. Two shopping-row display questions for the PO are in BACKLOG.md follow-ups.

## What Andy saw

On S11 under Meat & Seafood: "Chicken breast", checked and struck through, "added and checked off by Dean Chen", quantity **0 lb**. The other two checked rows (Paper towels, Olive oil) show 1.

## Why it matters

A shopping row never needs zero of something. A zero row is one of three things:
- bad data on the row (a seed or fixture value);
- a gap computed as zero that should never have become a row;
- a display bug, such as the amount after check-off being shown instead of the amount requested.

Shopping-gap math is rule-7 territory (deterministic, tested), so the cause decides the model.

## Next step

Investigate first (`sk-investigator`). Find where the row and its quantity came from: the seed, M7-T1's `shopping_rows`, the client's queue, or the check-off path. Write the fix ticket into this file. If the cause is in gap math or the PURCHASE path, implementation and review go to Opus (rule 23).

## Cause (sk-investigator, 2026-10-07; code reading, not reproduced on the practice database)

Not bad seed data and not a formatting bug. The seed (`apps/api/src/seed/fixture-shopping.ts:47-57`) has Chicken breast at a 2 lb need against the chicken item; the 0.75 lb gap is computed on every read. `toRowDto` in `apps/api/src/db/shopping/service.ts` (about :272-284) recomputes `buyMicros = neededQuantity(need, have)` from live inventory for every row, whatever its status. After check-off and Add, the PURCHASE (0.75 lb) raises the item to 2 lb, so every later read gives need 2 minus have 2, `buyMicros: "0"`, and the row stays `done`. S11 renders that value as "0 lb". Paper towels and Olive oil have no item, so their have stays 0. The existing test `shopping-http.db.test.ts` (about :657-662) asserts the 0. S11 also doesn't refresh the list after Add (`shopping.tsx` about :330-335), so the 0 shows on the next load.

## Fix ticket: BUG-006 — A checked-off shopping row keeps the amount that was bought

- **Implementation model:** Opus. Rule 23: the shopping gap read and the PURCHASE path.
- **Review model:** Opus. Same list.
- **Objective:** once a row's PURCHASE has landed (`added_transaction_id` set), `buyMicros` on the wire is the amount that PURCHASE appended, in the row's unit, read from the ledger. Before a PURCHASE lands, open and `done` rows show the live gap as today. Nothing about how the gap or the PURCHASE amount is computed changes.
- **Context:** this file; `apps/api/src/db/shopping/service.ts` (`toRowDto`, the row SQL, the add path), `gap.ts`, `packages/contracts/src/shopping.ts` (the `buyMicros` doc comment); `shopping-http.db.test.ts`. The ledger amount is `inventory_transactions.qty_delta_micros`, joined by `(household_id, item_id, added_transaction_id)`. `haveMicros`, `haveTier` and the computed `skipped` status for open rows stay as they are.
- **Dependencies:** none. Runs alongside M2-T8 (whose scope is `shopping-routes.ts`, not `service.ts`).
- **Invariants:** INV-SHOP-1 holds for every row without a landed PURCHASE (`buyMicros = max(0, need - have)` via `neededQuantity`); no new subtraction (rule 7); the ledger is only read, no migration, no change to the PURCHASE key, amount or idempotency (rule 10, ADR-008); the amount comes from the ledger row, never recomputed or taken from the client; household-scoped (INV-TENANT-1).
- **Architect ruling (undo):** a landed PURCHASE later undone on S5 still shows the amount that was bought on the row; the undo is its own ledger fact.
- **Acceptance criteria:**
  1. After check-off and Add, `GET /v1/shopping` and the check and uncheck responses show the row's `buyMicros` as the PURCHASE amount (chicken: `750000`), never 0.
  2. Unchecking after the Add keeps the bought amount; the current status on that path stays, unless it also reads as a zero row (then stop and report).
  3. A `done` row with no landed PURCHASE still shows the live gap; item-less rows unchanged.
  4. `"0"` appears only for an open row computed as skipped, as before; replaying Add still returns the same transaction and appends nothing.
  5. S11 needs no change; if any client file needs one, stop and report.
- **Tests required:** update the "unchecking after the add" assertion to the bought amount; new DB tests: check, Add, GET shows `750000` and still does after an unrelated stock increase; a `done` row with no PURCHASE keeps the live gap; a row whose PURCHASE was undone keeps the bought amount. `gap.test.ts` unchanged; contract drift tests green.
- **File scope:** `apps/api/src/db/shopping/service.ts`, `apps/api/src/db/shopping/shopping-http.db.test.ts` (and a pure test beside `service.ts` if one fits), `packages/contracts/src/shopping.ts` (the `buyMicros` doc comment only), `docs/handoff/BUG-006.worker.md`.
- **Out of scope:** gap math, `neededQuantity`, the PURCHASE amount; a schema change; count-unit rules (M2-T8); S11 wording or layout; the in-session list refresh after Add (follow-up).
- **DoD:** rule 26; this file marked FIXED at acceptance; the report proposes any `docs/**` wording for `buyMicros` semantics (architect applies, rule 30).
- **Open for the PO (not in this ticket):** a row checked but never Added, whose item's stock rose another way, still shows the live gap and could read 0. Keep, or show the original need instead.
