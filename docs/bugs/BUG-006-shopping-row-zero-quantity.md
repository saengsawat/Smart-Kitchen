# BUG-006: A checked shopping row shows "0 lb"

**Reported:** 2026-10-06 by Andy (PO), phone screenshot of S11 (Shopping), Android, Expo Go.
**Status:** OPEN. Cause not yet investigated.

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
