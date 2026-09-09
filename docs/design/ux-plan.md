# Mobile UX Plan — MVP (planning artifact; no build)

**Status:** PROPOSED (PO directive 2026-09-10). Governs the M3-E0 design epic in [BACKLOG.md](../../BACKLOG.md). Visual system: [design-direction.md](design-direction.md) · behavior: [design-principles.md](design-principles.md) · interactive reference: [mockups/smart-kitchen-prototype.html](mockups/smart-kitchen-prototype.html) (already PO-reviewed on-device). **Building anything here is gated on D-002 ratification (Dean) + M3-E0 sign-off.**

## 1. Information architecture

Five-tab shell, validated by the prototype:

```
Home (dashboard)  ·  Inventory  ·  [ Scan/Add — center FAB ]  ·  Recipes  ·  Shopping
Profile & household → avatar on Home header (not primary nav)
Assistant (post-MVP preview) → sparkle affordance on Home header, phase-labeled
```

Rationale: the scan button is the product's front door (P1) and owns the center; Home carries the daily-habit loop (tonight's match, accuracy nudge, use-it-soon); nav reflects MVP scope only (P10).

## 2. MVP screen inventory (12 screens + shared components)

| # | Screen | Purpose / load-bearing elements | Key states beyond happy path |
|---|---|---|---|
| S1 | Onboarding: account + household | Managed-auth sign-in; create/join household | join-code error; offline |
| S2 | Onboarding: allergies & preferences | Per-member allergy setup w/ severity; safety copy (P5); skippable prefs; **not** skippable allergy prompt (explicit "none" required) | user-defined allergen entry |
| S3 | Home dashboard | Greeting; tonight's-best-match card (match %, "Why this?"); kitchen snapshot tiles incl. **accuracy/needs-confirmation**; use-it-soon list | first-run empty (sells the scanner); no-recommendations |
| S4 | Inventory list | Location tabs; rows = qty (tabular) + expiry urgency + provenance badge; search | empty; filtered-empty; stale-cache offline |
| S5 | Item detail / history | The "why does the app think…" ledger view; one-tap correct; lot breakdown | corrected-state confirmation |
| S6 | Add hub | Four methods with phase labels (barcode live; receipt fast-follow; photo future; manual always) | — |
| S7 | Barcode scan (camera) | Live viewfinder; torch; manual code entry fallback | permission denied; no match → S9 |
| S8 | Scan confirm | Product card w/ per-field provenance; nutrition strip; allergen row (household match check, P5); qty stepper; location chips | multi-source conflict display; allergen-match warning |
| S9 | Manual add / completion | Prefill whatever any source returned, fields badged by provenance; unit picker (M1-T3 registry) | code-retained-for-enrichment note |
| S10 | Recipes ("What can I make?") | Ranked cards: uses-from-inventory chips, missing count, match %, "Why this?" expander, allergen screen status; blocked-card pattern (never a choice, P5) | generating/async; zero-candidates; all-blocked |
| S11 | Shopping list | BUY (gap math visible) / ALREADY HAVE; department groups; shared indicators (P7); check-off → add-to-inventory prompt (close the loop) | offline queue indicator; empty |
| S12 | Profile & household | Members, allergies (edit = S2 patterns), invite (fast-follow), sign-out | pending Q3 permission notes |

**Shared components:** provenance badge (3 tiers), verdict/warning banners (allergen red exclusive), correction sheet, ledger-history row, quantity stepper, unit-aware amount display, confirmation list-row (receipt-ready), toast/undo, sync-state indicator.

## 3. The three make-or-break flows (each gets validated before build)

1. **Onboard → first item (target < 60s from install):** S1→S2→S3(empty)→FAB→S7→S8→confirm→S4 showing the item with its Known-Fact badge. Success: a new user reaches a populated inventory with zero typing beyond account creation.
2. **Scan → confirm (the trust builder):** every probabilistic value visibly badged; correcting a wrong field cheaper than accepting it wrongly; "2 × 16 oz" quantity semantics explicit (brief §2A). Success metric hook: barcode resolution rate + manual-completion rate.
3. **Recommend → shop → close the loop:** S10 accept → S11 gap list → in-store check-off (offline-capable) → "add to inventory?" → ledger PURCHASE. Success: checked-off items land in inventory without re-entry (close-the-loop telemetry).

## 4. Design→build pipeline (M3-E0, gating M3)

1. **Wireframes** for all 12 screens incl. non-happy states (low-fi, fast, breadth-first).
2. **Hi-fi mockups** in the design-direction tokens — extend the existing clickable prototype rather than starting over; every S-screen and shared component.
3. **Copy deck** for all safety-relevant strings (P5's nine rules applied verbatim; allergen warnings; provenance labels; correction language) — reviewed against SR-1/SR-2 like code.
4. **Validation:** PO (Andy) + product originator (Dean) review the updated prototype on-device; at least one real-household hallway test of flows 1–3 using the prototype; findings logged, design iterated once.
5. **Exit gate:** PO sign-off recorded in DECISIONS + **D-002 ratified** ⇒ M3 build tickets get written (not before).

## 5. Open design decisions (owner input)

| ID | Question | Default if unanswered |
|---|---|---|
| OQ-D1 | Brand accent: terracotta (current) vs fresh-green | Terracotta stands |
| Q8 | Product name/brand (affects app title, icon, stores) | Placeholder "Smart Kitchen" persists |
| OQ-D4 | Home = dashboard (current) vs inventory-first | Dashboard stands (prototype-validated) |
| OQ-D5 | Onboarding allergy step: per-member at signup vs household-owner-enters-all | Owner-enters-all at signup, members confirm on join (conservative; pending Q3) |
| OQ-D6 | Dark mode at MVP launch or fast-follow | Tokens support it (design-direction); ship light-first, dark fast-follow |

## 6. Explicitly out of this plan
Assistant/chat UI (post-MVP; preview pattern already in prototype), receipt & shelf-photo capture UIs beyond their phase-labeled stubs (fast-follow/future — designed when their pipelines land), meal planning, nutrition dashboard, tablet/web layouts, i18n.
