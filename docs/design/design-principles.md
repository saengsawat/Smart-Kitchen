# Design Principles — Mobile UX (binding for M3+)

**Status:** PROPOSED (PO directive 2026-09-10: plan UI/UX after foundation, build nothing yet). Visual tokens live in [design-direction.md](design-direction.md); this file is the *behavioral* contract every screen must satisfy. Sources: brief §14/§18C/§18F, MVP_PRD SR-1..4 & FR-PROV-1, D-017, M1-T4 handoff §6.

## P1 — The app saves work; it never asks for bookkeeping (brief §18F)
Every screen is judged by "did the user do less than they would have without us?" Manual entry is always *available* (FR-INV-3) but never the designed happy path. Onboarding must reach "first item in inventory" in under a minute, via camera, before any profile-building beyond allergies.

## P2 — The system shows its work: provenance is visible, always (brief §14)
Every fallible fact wears its tier — **Known Fact / Estimated / AI** — as the badge system already validated in the prototype (green/amber/purple, purple used for nothing else). No AI-derived value ever renders indistinguishable from a verified one. Estimated dates say *estimated* and invite correction inline.

## P3 — Correction is a first-class gesture, not an apology (brief §18C)
The correction rate is the product's north-star metric, so correcting must be the cheapest gesture in the app: one tap from any inventory row to fix quantity/existence, and every row can answer *"why does the app think this?"* with its ledger history. Corrections are never buried in edit screens. The UI language treats a correction as the user teaching the system, not fixing an error message.

## P4 — Confirmation gates all probabilistic input (brief §2B/§2C, SR-4)
Nothing AI-proposed enters inventory without explicit confirmation. Confirmation screens do real work: they surface per-field provenance, pre-select high-confidence items, and make "fix this one line" cheaper than "accept all." Low-confidence lines visually demand attention (the receipt "ORG BNNA 3LB — is this bananas?" pattern).

## P5 — Allergen surfaces follow the nine copy rules, verbatim (M1-T4 §6, D-017)
Binding, already attached to the M3/M6 epics: never "safe"/"allergen-free"/green-check-as-clearance (ALLOWED renders as *"no known allergen match"*); the standing no-guarantee caveat always visible with a verdict; unknowns never collapse into allowed and always say *what* is unknown; critical warnings prominent; copy keyed off machine codes, never message strings; BLOCKED never displayed as a choice; evidence always shown ("contains peanut — matched 'peanuts' in…"); per-member attribution ("blocked for Maya"); "no allergen data" never becomes "no allergens listed."

## P6 — Numbers behave like a ledger, because they are one
Quantities use tabular numerals and never jitter; a quantity change is always attributable on tap (P3). Shopping-gap math shows its inputs ("need 2 lb − have 1.25 lb"). Sums shown to users are the deterministic engine's — the UI computes nothing itself.

## P7 — Household-shared state looks shared
Shared surfaces (inventory, shopping list) show who did what where it matters (check-offs, corrections) and reflect other members' changes without manual refresh. Member-private data (profiles, later goals) is never rendered on shared surfaces pending Q3.

## P8 — Honest states everywhere
Every screen designs its empty, loading, error, and offline states before its happy path. Empty states teach the loop (an empty inventory sells the scanner, not a lecture). Offline: reads from cache are marked stale-if-stale; the shopping list works offline (brief §6); writes queue visibly, never silently fail (ADR-010).

## P9 — Accessibility is baseline, not polish
WCAG 2.2 AA targets: contrast per the documented token ratios, touch targets ≥44pt, dynamic type without truncating safety copy, screen-reader labels for every badge/verdict (a color-only allergen signal is forbidden — color+icon+text, per SR-2 practice), reduced-motion respected.

## P10 — Scope honesty in the UI itself
Post-MVP capabilities visible in the product (receipt scan, shelf photo, assistant) wear their phase plainly, as the prototype does ("fast-follow", "future", "post-MVP preview") — the UI never advertises what the build can't do yet without saying so.
