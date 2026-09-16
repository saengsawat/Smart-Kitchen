# Copy Deck · Safety and Provenance Strings

**Status:** PROPOSED. Binding on client implementation once the PO signs off M3-E0 (BACKLOG.md M3-E0-T2 DoD: "the M3 epic links the deck as binding").

**Scope:** every user-visible string for allergen verdicts, provenance chips, corrections, consumption/shortfall prompts, confirmation trays, phase labels, empty/offline/error/permission states, and the user-facing ledger errors. Out of scope: i18n, marketing copy, assistant dialogue beyond the one labelled preview line this deck needs for coverage.

**Binding rules this deck must satisfy (read together):**

- The nine allergen copy rules, [M1-T4 worker report §6](../handoff/M1-T4.worker.md), quoted verbatim in §1 below except that this deck's own zero-em-dash rule (next bullet) has been applied to the two rules that contained one; the substance is unchanged.
- [design-principles.md](design-principles.md) P2 (provenance always visible), P3 (correction is teaching, not apology), P5 (the nine rules are binding), P8 (every screen designs its non-happy states), P10 (phase honesty), **P11 (no em dashes anywhere, sentence case, no colon-as-label, no exclamation marks in safety copy)**.
- [DECISIONS.md](../../DECISIONS.md) **D-017**, the ratified allergen policies (P1 cross-contact, P2 molluscs, P3 coconut, P4 severe+unknown stays unknown, P5 sourced declarations only). This deck's copy must never contradict them (e.g. must never suggest a `MAY_CONTAIN` standard-severity result is "cleared").
- [M1-T6 review F7](../handoff/M1-T6.review.md). `ALLOWED` can co-occur with the `UNRECOGNIZED_ALLERGEN_DATA` warning. The warning renders regardless of verdict; it is never suppressed because the verdict looks permissive.
- [design-direction.md §7](design-direction.md). The neutral verdict line and standing caveat were fixed at adoption. This deck reuses that wording (§3.1).

**How strings are keyed:** every row below is keyed by a **machine code** (`ScreeningVerdict`, `UnknownReason`, `WarningCode`, `EvidenceKind`, `TransactionType`, `LedgerErrorCode`, etc., from `packages/domain/src/allergens/types.ts` and `packages/domain/src/inventory/{types,errors}.ts`), never by the domain's `message`/`detail` strings, which are machine-facing and not localized (rule 5 of the nine). The client looks up copy by `code` (plus, where noted, `severity` or `evidenceKind`) and interpolates the named placeholders (`{member}`, `{allergen}`, `{n}`, `{qty}`, `{date}` …) from typed fields, never from free text.

**Anchors:** the "deck section" column in §9 (coverage table) refers to the numbered section (e.g. `§3.1`), not a URL fragment. Section numbers are stable across renderers, hyperlink slugs are not.

---

## §1. The nine allergen copy rules (verbatim, em dashes replaced by a full stop or `·` per P11)

Source: [M1-T4 worker report §6](../handoff/M1-T4.worker.md). Two of the nine (marked \*) contained an em dash in the original; the words are otherwise unchanged.

1. Never render any verdict as "safe", "allergen-free", "OK to eat", or a green check that reads as clearance. `ALLOWED` renders as **"no known allergen match"**.
2. Every result carries a `NO_SAFETY_GUARANTEE` warning (always, including on `ALLOWED`). Its standing caveat must be shown wherever a verdict is shown. It is `severity: "info"` because it is always present. That is a rendering hint, not permission to omit it.
3. `ALLOWED_WITH_UNKNOWNS` must never be visually collapsed into `ALLOWED`. They are different states and the middle one is the honest majority case early on. Show *what* is unknown: each `ScreeningUnknown` names `restrictionLabel`, `severity`, `reason` and `locus` for exactly this purpose.
4. `critical` warnings must be prominent (brief §3: "a prominent warning" for serious allergies): `SEVERE_ALLERGY_UNKNOWN_DATA`, `CROSS_CONTACT_SEVERE`. `high`: `CROSS_CONTACT`, `UNRECOGNIZED_ALLERGEN_DATA`.
5. Key copy off `warning.code` and `unknown.reason`, never off `message`. The `message` strings are machine-facing, deliberately terse, and not localized.
6. \*A `BLOCKED` recommendation is never displayed as a choice (INV-ALRG-1). Filtering is the caller's job. `partitionByVerdict` returns exactly that split. Showing it greyed-out with a reason is a product decision; showing it as selectable is a bug.
7. \*`BLOCKED` always has evidence. Show it. `ScreeningEvidence` names the member, the restriction, which locus, and the matched term/text, so "why" is always answerable ("contains peanut · matched 'peanuts' in the ingredients of *Breakfast bar*").
8. \*Per-member results exist (`result.members`). A household verdict alone is not enough UI. Say *whose* restriction blocked it.
9. Unknown ≠ absent. Copy for `reason: "NO_ALLERGEN_DATA"` should say "we don't have allergen information for this item", never "no allergens listed".

---

## §2. Global voice rules

- **Person in a kitchen, not a machine (P11).** Short plain sentences. No em dashes anywhere in this file. Use a full stop, a comma, or the app's middle-dot separator `·` instead. No colon-as-label constructions in running copy ("Status: Blocked" is wrong; "Blocked for Maya" is right). No exclamation marks in any safety-adjacent string (allergen verdicts, corrections, clamp/shortfall copy, ledger errors).
- **Sentence case everywhere.** Not Title Case, not ALL CAPS, except a code-style token being named as itself (e.g. `ALLOWED`) in this deck's own prose.
- **Member attribution** reads as "for {name}" (singular) or the join rule below (plural), never a raw `memberId`. The client resolves `memberId` to the household member's display name before interpolating.
  - 1 member: "for Maya"
  - 2 members: "for Maya and Théo"
  - 3+ members: "for 3 members (Maya, Théo, Sam)". Never truncate the list silently. If space is tight, truncate the *sentence*, not the roster (see §3.5).
- **Allergen names** interpolate `MAJOR_ALLERGEN_LABELS` from `packages/domain/src/allergens/taxonomy.ts` (`peanut`, `tree nut`, `milk`, `egg`, `fish`, `crustacean shellfish`, `wheat`, `soy`, `sesame`) for `MAJOR` restrictions, or the member's own wording for `USER_DEFINED` ones (`restrictionLabel`). That map is documented as "a fallback UI label, not final copy". This deck adopts it as-is for MVP; a dedicated display-name/pluralization pass is a proposed backlog item (see the worker report), not invented here.
- **Quantities** are formatted by the unit registry (`packages/domain/src/inventory/quantity.ts` and the M1-T3 unit registry), always with tabular numerals (`tnum`), never hand-typed or rounded ad hoc by a screen.
- **The standing caveat** (`NO_SAFETY_GUARANTEE`, §3.1) appears under **every** verdict line on **every** surface, with no exception. It is the one line every table below assumes is present even when a row does not repeat it.
- **Colour is never the sole signal (P9).** Every string in this deck must stand on its own without a colour cue: no "the amber one", no "shown in red". Tier chips and verdict rows pair colour with an icon and this text.
- **No string states or implies certainty about absence.** Every ALLOWED-adjacent string says "no known match" or "no known match found", never "safe", "clear", "free of", or "none".

---

## §3. Allergen verdicts

Each subsection is one surface. All four render the same three-state `ScreeningVerdict` (`BLOCKED` / `ALLOWED_WITH_UNKNOWNS` / `ALLOWED`); §3.1 (recipe detail) is the canonical, most complete surface and the other three are documented as deltas from it.

### §3.1 Recipe detail (canonical)

**Verdict lines**

| Code | String | Tone note | Forbidden alternatives |
|---|---|---|---|
| `ALLOWED` | "No known allergen match · {n} members" | Neutral ink, not green. Always paired with the standing caveat (`NO_SAFETY_GUARANTEE` row below). | "Safe for your household", "Allergen-free", a green check used as clearance. |
| `ALLOWED` **+** `UNRECOGNIZED_ALLERGEN_DATA` | Verdict line unchanged, **plus** "Some of this item's allergen data couldn't be read. It didn't change this result, but check the label yourself." | M1-T6 F7: this warning renders even though the verdict is `ALLOWED`. Never suppressed because the headline looks permissive. `high` severity, so it sits directly under the verdict line, not buried in an expander. | Hiding the warning because the verdict is permissive; downgrading it to `info`. |
| `ALLOWED_WITH_UNKNOWNS` | "Allergen data incomplete · {n} members affected" (headline), each affected member/restriction gets its own unknown line, §"Unknown lines" table below | Never collapsed into `ALLOWED` (rule 3). Amber-adjacent ink is fine as a *pairing*, never the only signal. | "Probably fine", "Unclear, proceed with caution", "Likely safe". |
| `BLOCKED` | "Blocked · {n} members affected", each match gets its own evidence line, §"Evidence lines" table below | Never offered as a choice (rule 6): the card is visibly non-actionable (no "Cook this" button; see §3.5). | Any wording that reads as "tap to override", "block anyway", or a confirm dialog that would let a user proceed. |

**Unknown lines (`ALLOWED_WITH_UNKNOWNS` × `UnknownReason`, standard vs severe)**

One line per affected `(member, restriction)`. `severity` comes from the restriction, not the reason.

| `UnknownReason` | Standard-severity string | Severe-severity string | Tone note |
|---|---|---|---|
| `NO_ALLERGEN_DATA` | "We don't have allergen information for this item, so {member}'s {allergen} allergy is unresolved." | "We don't have allergen information for this item. This matters for {member}'s severe {allergen} allergy." | Never "no allergens listed" (rule 9). |
| `INCOMPLETE_DECLARATION` | "The label on file doesn't say whether it covers {member}'s {allergen} allergy." | "The label on file doesn't say whether it covers {member}'s severe {allergen} allergy." | Names what the declaration *does* claim only if the client has that data to show; otherwise this line stands alone. |
| `UNVERIFIED_DECLARATION_TIER` | "This item's completeness claim hasn't been confirmed yet, so we can't clear {allergen} for {member}." | "This item's completeness claim hasn't been confirmed yet. It can't clear {member}'s severe {allergen} allergy." | Ties to the provenance tier system (§4): the declaration exists but is `ESTIMATED`/`AI_INTERPRETATION`, not `KNOWN_FACT`. |
| `UNSOURCED_DECLARATION` | "This item's completeness claim doesn't name a source we can check, so {allergen} is unresolved for {member}." | "This item's completeness claim doesn't name a source we can check. {member}'s severe {allergen} allergy stays unresolved." | D-017 P5: an unattributable declaration never licenses "no known match". |
| `NO_INGREDIENT_TEXT` | "There's no ingredient list on file to check for {member}'s {allergen} allergy." | "There's no ingredient list on file to check for {member}'s severe {allergen} allergy." | A product/recipe name alone never counts as an ingredient statement. |
| `UNRECOGNIZED_ASSERTION_CODE` | "This item lists an allergen code we don't recognize, so we can't clear {allergen} for {member}." | "This item lists an allergen code we don't recognize. It can't clear {member}'s severe {allergen} allergy." | The code is a data quality issue, not evidence either way. |
| `UNRECOGNIZED_ASSERTION_KIND` | "This item's allergen data uses a claim type we don't recognize, so {allergen} stays unresolved for {member}." | "This item's allergen data uses a claim type we don't recognize. {member}'s severe {allergen} allergy stays unresolved." | Covers any non-`CONTAINS`/`MAY_CONTAIN` claim, including an invented "free from" style claim (D-017: never clears). |
| `MALFORMED_ALLERGEN_DATA` | "This item's allergen data is in a format we can't read, so {allergen} stays unresolved for {member}." | "This item's allergen data is in a format we can't read. {member}'s severe {allergen} allergy stays unresolved." | Distinct from `NO_ALLERGEN_DATA`: data is present but unreadable, not absent. Can co-occur with `ALLOWED` when it affects a *different* member/restriction than the one that resolved (M1-T6 F7 family). Always shown regardless of the household verdict. |

**Evidence lines (`BLOCKED` × `EvidenceKind`)**

| `EvidenceKind` | String | Tone note |
|---|---|---|
| `ASSERTION_CONTAINS` | "Contains {allergen} · stated by the manufacturer · blocked for {member}" | Strongest evidence class; no hedging language. |
| `ASSERTION_MAY_CONTAIN` | "May contain {allergen} (cross-contact) · stated by the manufacturer · blocked for {member}" | Only reachable for a `severe` restriction (D-017 P1: `standard` + `MAY_CONTAIN` never blocks, see `CROSS_CONTACT` warning instead). |
| `INGREDIENT_TEXT_TERM` | "Contains {allergen} · matched '{matchedText}' in the ingredient statement · blocked for {member}" | The BACKLOG's own worked example: "Contains peanut · matched 'peanuts' in the ingredient statement · blocked for Maya". |
| `NAME_TERM` | "Contains {allergen} · matched '{matchedText}' in the name · blocked for {member}" | Same pattern, locus is the product/ingredient name rather than the ingredient statement. |
| `ASSERTION_CODE_TERM` | "Contains {allergen} · matched the allergen tag '{matchedTerm}' · blocked for {member}" | A user-defined term matched a taxonomy-uncovered assertion code (e.g. a `mustard` tag against a user's mustard allergy). |

**Warnings (`WarningCode`)**

| `WarningCode` | `WarningSeverity` | String | Where it appears |
|---|---|---|---|
| `NO_SAFETY_GUARANTEE` | `info` (always present, not a rendering hint to omit) | "Known matches only. Not a guarantee this food is safe." | Directly under every verdict line, on every surface, with no exception. |
| `SEVERE_ALLERGY_UNKNOWN_DATA` | `critical` | Rendered through the severe-severity unknown line above, not as a separate sentence; the *prominence* is the requirement (rule 4), delivered by placement/icon, not by inventing extra copy. | Wherever a severe-severity unknown line appears. |
| `CROSS_CONTACT` | `high` | "This item may have cross-contact with {allergen} (the manufacturer says 'may contain'). Not blocked, because {member}'s allergy is standard severity." | Attached to an `ALLOWED_WITH_UNKNOWNS` result for a standard-severity restriction (D-017 P1). |
| `CROSS_CONTACT_SEVERE` | `critical` | Rendered through the `ASSERTION_MAY_CONTAIN` evidence line above (it also blocks); no separate sentence needed. | Wherever that evidence line appears. |
| `UNRECOGNIZED_ALLERGEN_DATA` | `high` | "Some of this item's allergen data couldn't be read. It didn't change this result, but check the label yourself." | Rendered regardless of verdict (M1-T6 F7), including on `ALLOWED`. |

### §3.2 Recipe card (compact)

The card is a summary; every card is tappable through to §3.1 for the full evidence/unknown detail.

| Code | Compact string | Delta from §3.1 |
|---|---|---|
| `ALLOWED` | "No known match · {n} members" | Caveat is not repeated on the card itself; it appears once, in the tap-through detail, and in the one-time provenance/allergen legend (§4). |
| `ALLOWED_WITH_UNKNOWNS` | "Allergen data incomplete for {n} members" | No per-reason detail on the card; tapping opens §3.1's unknown lines. Never rendered with the same visual weight as `ALLOWED` (rule 3). |
| `BLOCKED` | "Blocked for {n} members" | Card is visibly non-actionable: greyed treatment, no primary action, per rule 6. Tapping opens the evidence lines; there is no "cook anyway" affordance anywhere in the tap-through. |

### §3.3 Scan sheet (barcode confirm)

Per design-direction §7 fix #3: **Known Fact** on this surface is scoped to *product identity* (the barcode matched a catalog row). The allergen row is its own, separately tiered line, because the catalog's allergen *data* may be a lower tier than the identity match.

| Code | String | Tone note |
|---|---|---|
| `ALLOWED` | "No known household match · label declaration · not a safety guarantee" | Verbatim from design-direction §7's adoption fix; already P11-compliant (no em dash) as adopted. |
| `ALLOWED_WITH_UNKNOWNS` | "Allergen data unknown for {member}, severe {allergen} allergy · {product} has no ingredient statement on file · not blocked, not cleared" | The design-direction §7 worked example (Maya/sesame/miso), generalized and adjusted to drop the source wording's parenthetical colon ("severe: sesame"), a colon-as-label shape P11 forbids in live copy. "Not blocked, not cleared" is this surface's compact restatement of rule 3 and belongs only here, where card space is tightest. |
| `BLOCKED` | "Matched '{matchedText}' in the ingredient statement · blocked for {member}" | Same evidence requirement as §3.1, condensed to one line because the scan sheet already shows the product name in its header. |

### §3.4 Assistant preview (post-MVP preview, labelled per P10)

This is the one surface allowed to state the negative "can't mark ... safe" directly (see §10, exception 2), because it is the assistant explaining its own limits, not asserting a result.

| Code | String | Tone note |
|---|---|---|
| `ALLOWED` | "No known allergen match for your household. I can't mark any food as safe. Always check a new product's own label." | Conversational register; still no em dash, no exclamation mark (safety copy rule holds even in the assistant's voice). |
| `ALLOWED_WITH_UNKNOWNS` | "I don't have enough allergen data to clear this for {member}'s {allergen} allergy. I'm not saying it's a problem, just that I can't confirm it either way." | Keeps the "unknown ≠ absent, unknown ≠ present" framing in plain conversational language. |
| `BLOCKED` | "I'd skip this one. It's blocked for {member}'s {allergen} allergy, so I won't suggest it." | Still no offered override; the assistant does not present a "suggest anyway" option (rule 6 applies to every surface, including chat). |

### §3.5 Per-member roll-up and card non-actionability

- Roll-up join rule is §2's global rule (1 / 2 / 3+ members). Applies identically to `BLOCKED` evidence lines and severe-unknown lines.
- A `BLOCKED` card/row never carries a primary action. Where a design shows a "Cook this" or "Add to plan" button on an `ALLOWED`/`ALLOWED_WITH_UNKNOWNS` card, the equivalent `BLOCKED` card has no button in that position at all (not a disabled button with a tooltip explaining why it's disabled). The row itself is the explanation, per rule 6 and design-direction §7's rejection of "blocking confirmation" dialogs.

---

## §4. Provenance chips and legend

Three tiers (`ProvenanceTier`, shared by allergens and inventory). The AI chip is an **action** ("Confirm"), never a passive label (design-direction §7 adoption note).

| Tier | Chip label | One-line legend text | Tap-through template |
|---|---|---|---|
| `KNOWN_FACT` | "Known Fact" | "Confirmed by a barcode scan, a printed date, or your own entry." | "Known Fact · scanned barcode 0689…" |
| `ESTIMATED` | "Estimated" | "A reasonable estimate, not a confirmed fact. Tap to correct it." | "Estimated · shelf-life for fresh chicken, 2 days" |
| `AI_INTERPRETATION` | "AI" (rendered as the `Confirm` action, not a static chip) | "Read by AI from a photo or receipt. Confirm it before it's counted as fact." | "AI · read from your receipt, please confirm" |

- Every fallible fact wears one of these three (P2); there is no "no chip" state (design-direction §7 explicitly rejected an absent chip as ambiguous with "no data").
- The one-time provenance legend (shown once, first encounter, per ux-plan's shared components) uses exactly the three legend lines above, in tier order, plus one closing line: "You can always tap a fact to see where it came from." No em dash, no exclamation mark.
- A chip is never colour-only: each pairs an icon (identity icon, a ~ estimate glyph, a spark for AI) with its text label (P9).

---

## §5. Correction and consumption

Teaching, not apologising (P3): every string below describes what happened and invites a fix, never "you made a mistake" framing.

### One-tap correct

- Entry point label on every inventory row and ledger line: **"Fix this"**.
- Corrected-state confirmation (S5's non-happy state): "Updated. This will show in everyone's inventory." No exclamation mark.
- Undo toast text: **"Corrected. Undo"**. The toast's time window is a client behavior parameter, not copy, and is not invented here.

### Reason chips (consumption/removal)

Brief §7 lists six reasons (Used, Consumed, Discarded, Expired, Donated, Manually adjusted); `TransactionType` is documented as "a superset of brief §7 reasons" and adds `USE_IN_MEAL` distinctly from `CONSUME`. This mapping is an **ENGINEERING INFERENCE** (rule 5 classification), not sourced verbatim from either document, and is flagged as a judgment call in the worker report:

| Chip label | `TransactionType` | When shown |
|---|---|---|
| "Cooked" | `USE_IN_MEAL` | Automatically, via the recipe "Cook this" → confirm flow (FEFO/FIFO deductions); not manually chosen from a bare reason list. |
| "Used" | `CONSUME` | Manual removal outside a logged recipe ("I used some of this"). |
| "Discarded" | `DISCARD` | Manual, thrown away. |
| "Expired" | `EXPIRE` | Manual or a prompted nudge from an expiring-soon item. |
| "Donated" | `DONATE` | Manual. |
| *(not a reason chip)* | `ADJUSTMENT` | The one-tap-correct mechanism itself (quantity/existence fix), not offered alongside the removal-reason chips. |
| *(not a reason chip)* | `INITIAL_STOCK`, `PURCHASE` | Entry-side transactions (first stock, buying more), not removal reasons. |

### The clamp (system-authored correction)

Verbatim system row, visibly distinct from a user's own entry (system `Actor`, never attributed to a person):

> "You used 0.75 lb more than we had on record. Inventory corrected."

Tone note: this row must be visually distinguishable as system-authored (an "auto" tag or a system icon, not colour alone, per P9). It is not something any household member typed.

### Shortfall prompt for cooking (record-and-flag, PROPOSED)

Per the decision brief's proposed policy for OQ-1/A9 (record the full statement, accept the ledger's clamp, then prompt): this wording is **PROPOSED, pending PO decision** (docs/po/decision-brief-2026-09.md A9 is not yet a DECISIONS.md entry):

> Primary (proposed): "We only had {allocatedQty} {unit} of {item}, {shortfallQty} {unit} short of what the recipe used. Fix your inventory?", with actions **Update quantity** / **Not now**.
>
> Alternative wording noted for the PO's consideration, not adopted: a softer framing that leads with the recipe outcome ("Your {item} ran out partway through this recipe.") before the fix prompt. Flagged here rather than chosen, per rule 3/4 (never resolve an open product question by assumption).

### "Why does the app think this?" template

Chronological ledger rows, one line per `RecordedTransaction`, in `sequence` order:

> "{action label} · {signed qty} {unit} · {date} · {who or source}"

Examples: "Purchased · +2 lb · Sep 12 · scanned receipt", "Cooked · −0.5 lb · Sep 14 · used in Chicken Tacos", "Corrected · +0.25 lb · Sep 15 · you". A row carrying `systemFlag` (the clamp) instead reads as the §5 clamp string above, not this generic template, so it is never mistaken for a user statement.

---

## §6. Confirmation trays and phase labels

- **"Needs your confirmation"**, the pinned tray heading for every AI-tier proposal awaiting the `Confirm` action (§4). Never auto-dismissed; never silently accepted.
- **Phase labels (P10),** exact wording, plain badge text next to the feature it describes:
  - **"fast-follow"**, built after MVP launch, already planned. Appears on household invite (S12) and non-MVP Add methods beyond the MVP barcode path (brief's multi-method Add screen note).
  - **"future"**, not yet scheduled. Appears on capabilities named in the brief but with no committed MVP-adjacent date.
  - **"post-MVP preview"**, visible and partially working today, but not a build target for MVP. Appears on the assistant entry point (Home header sparkle affordance, §3.4).

---

## §7. Empty / offline / error / permission states

Per P8 (every screen designs its non-happy states first). Format: headline, one sentence, the action (if any).

### S3 · Home dashboard

- **First-run empty:** "Your kitchen is empty, for now." / "Scan a barcode and most people are stocked in under a minute." / action **Scan a barcode**.
- **No recommendations:** "Nothing to recommend yet." / "Add a few items and we'll suggest what to cook." / action **Add food**.

### S4 · Inventory list

- **Empty (a location has nothing in it):** "No items here yet." / "Everything you add to this location will show up here." / action **Add an item**.
- **Filtered-empty:** "No items match that filter." / "Try a different location or clear your search." / action **Clear filter**.
- **Stale-cache offline:** banner, not a full-screen state: "Showing your last saved list. Changes from your household will appear when you're back online." No action button; informational.

### S7 · Barcode scan (camera)

- **Permission denied:** "Camera access is off." / "Turn it on to scan barcodes, or add this item by hand." / actions **Open Settings** and **Enter manually**.
- **No match:** hands off to S9 (manual completion), not a dead end; no separate empty-state copy needed here beyond the hand-off itself.

### S10 · Recipes ("What can I make?")

- **Generating (async):** "Finding what you can make." / "This takes a few seconds." (loading; no action).
- **Zero candidates:** "Nothing matches right now." / "Add a few more items or loosen a filter and we'll look again." / action **Adjust filters**.
- **All blocked:** "Every match today is blocked for someone in your household." / "We never offer a blocked recipe as a choice, even a close one." / action **See what's blocked** (expands the blocked list transparently; still no "cook anyway", per §3.5).

### S11 · Shopping list

- **Empty:** "Your shopping list is empty." / "Anything with a gap between what you need and what you have will show up here." / action **Browse recipes**.
- **Offline queue banner:** "You're offline. Check-offs are saved and will sync when you're back online."
- **Queued check-off row indicator:** a small "Queued" tag next to the checked row (icon + text, never a colour change alone, per P9).

---

## §8. User-facing ledger errors

Every value of `LedgerErrorCode` (`packages/domain/src/inventory/errors.ts`), classified as user-facing (a normal action can plausibly trigger it, so it earns its own sentence) or internal-only (an invariant violation the client should have prevented; if it ever leaks through, show the generic fallback and never the raw `message`).

**Generic fallback** (used for every internal-only code, if one ever reaches a screen): "Something went wrong saving that. Try again, and tell us if it keeps happening."

| `LedgerErrorCode` | User-facing? | String | Reasoning |
|---|---|---|---|
| `ZERO_DELTA` | Yes | "Enter an amount to record a change." | Reachable by confirming a form with no quantity entered. |
| `WRONG_SIGN` | Yes | "That doesn't match {action}. Check the amount and try again." | Reachable via manual entry (e.g. a negative number typed into a purchase field). |
| `QUANTITY_OUT_OF_RANGE` | Yes | "That amount looks too large. Double check it." | Reachable by a fat-fingered extra digit. |
| `PRECISION_EXCEEDED` | Yes | "Enter the amount with fewer decimal places." | Reachable by typing more precision than the unit supports. |
| `INVALID_TIMESTAMP` | Yes | "That date doesn't look right. Check it and try again." | Reachable via manual date entry on a correction. |
| `TIMESTAMP_ORDER` | Yes | "That date is in the future. Enter when it actually happened." | Reachable when a backdated correction's "when it happened" is later than "when it was recorded" (now). |
| `UNKNOWN_LOT` | Yes | "This lot isn't available anymore. Refresh and try again." | Reachable in a shared household: another member closed or consumed the lot first. |
| `MIXED_UNITS` | No (internal-only) | generic fallback | The client should never offer a unit that differs from the item's declared unit (M1-T1: one unit per item); reaching this means a client bug. |
| `DUPLICATE_LOT` | No (internal-only) | generic fallback | Opening a lot with a colliding id is a client-side id-generation bug. |
| `INVALID_IDEMPOTENCY_KEY` | No (internal-only) | generic fallback | Purely client/sync plumbing; never user-meaningful. |
| `IDEMPOTENCY_KEY_CONFLICT` | No (internal-only) | generic fallback | A retried write with a changed payload under the same key; a client bug, not a user action. |
| `INVALID_FIELD` | No (internal-only) | generic fallback | Catch-all for malformed input the client should have validated first. |
| `ITEM_MISMATCH` | No (internal-only) | generic fallback | Stored rows not belonging to the item being read; a data-integrity condition, not a user mistake. |
| `CORRUPT_LEDGER` | No (internal-only) | generic fallback, plus a support-contact affordance if the client has one | The most serious internal condition; never described to the user beyond the generic fallback. |

---

## §9. Coverage table

One row per machine-code union member covered by this deck, mapped to the section that carries its string (or its "no separate string, rendered through X" note).

| Union | Member | Deck section |
|---|---|---|
| `ScreeningVerdict` | `ALLOWED` | §3.1–§3.4 |
| `ScreeningVerdict` | `ALLOWED_WITH_UNKNOWNS` | §3.1–§3.4 |
| `ScreeningVerdict` | `BLOCKED` | §3.1–§3.4 |
| `UnknownReason` | `NO_ALLERGEN_DATA` | §3.1 (unknown lines) |
| `UnknownReason` | `INCOMPLETE_DECLARATION` | §3.1 (unknown lines) |
| `UnknownReason` | `UNVERIFIED_DECLARATION_TIER` | §3.1 (unknown lines) |
| `UnknownReason` | `UNSOURCED_DECLARATION` | §3.1 (unknown lines) |
| `UnknownReason` | `NO_INGREDIENT_TEXT` | §3.1 (unknown lines) |
| `UnknownReason` | `UNRECOGNIZED_ASSERTION_CODE` | §3.1 (unknown lines) |
| `UnknownReason` | `UNRECOGNIZED_ASSERTION_KIND` | §3.1 (unknown lines) |
| `UnknownReason` | `MALFORMED_ALLERGEN_DATA` | §3.1 (unknown lines) |
| `WarningCode` | `NO_SAFETY_GUARANTEE` | §3.1 (warnings), §2 |
| `WarningCode` | `SEVERE_ALLERGY_UNKNOWN_DATA` | §3.1 (warnings, rendered through the severe-unknown line) |
| `WarningCode` | `CROSS_CONTACT` | §3.1 (warnings) |
| `WarningCode` | `CROSS_CONTACT_SEVERE` | §3.1 (warnings, rendered through the `ASSERTION_MAY_CONTAIN` evidence line) |
| `WarningCode` | `UNRECOGNIZED_ALLERGEN_DATA` | §3.1 (verdict lines + warnings) |
| `WarningSeverity` | `info` | §3.1 (`NO_SAFETY_GUARANTEE` row) |
| `WarningSeverity` | `high` | §3.1 (`CROSS_CONTACT`, `UNRECOGNIZED_ALLERGEN_DATA` rows) |
| `WarningSeverity` | `critical` | §3.1 (`SEVERE_ALLERGY_UNKNOWN_DATA`, `CROSS_CONTACT_SEVERE` rows) |
| `EvidenceKind` | `ASSERTION_CONTAINS` | §3.1 (evidence lines) |
| `EvidenceKind` | `ASSERTION_MAY_CONTAIN` | §3.1 (evidence lines) |
| `EvidenceKind` | `INGREDIENT_TEXT_TERM` | §3.1 (evidence lines) |
| `EvidenceKind` | `NAME_TERM` | §3.1 (evidence lines) |
| `EvidenceKind` | `ASSERTION_CODE_TERM` | §3.1 (evidence lines) |
| `RestrictionOutcome` | `MATCH` | §3.1 (drives `BLOCKED`; no separate string, see evidence lines) |
| `RestrictionOutcome` | `POSSIBLE_MATCH` | §3.1 (drives `CROSS_CONTACT`/`CROSS_CONTACT_SEVERE`; no separate string) |
| `RestrictionOutcome` | `UNKNOWN` | §3.1 (drives `ALLOWED_WITH_UNKNOWNS`; unknown lines) |
| `RestrictionOutcome` | `NO_KNOWN_MATCH` | §3.1 (drives `ALLOWED`; no separate string beyond the verdict line) |
| `RestrictionSeverity` | `standard` | §3.1 (standard-severity column of every table) |
| `RestrictionSeverity` | `severe` | §3.1 (severe-severity column of every table) |
| `TransactionType` | `INITIAL_STOCK` | §5 (reason chips table, entry-side note) |
| `TransactionType` | `PURCHASE` | §5 (reason chips table, entry-side note) |
| `TransactionType` | `CONSUME` | §5 ("Used" chip) |
| `TransactionType` | `USE_IN_MEAL` | §5 ("Cooked" chip) |
| `TransactionType` | `DISCARD` | §5 ("Discarded" chip) |
| `TransactionType` | `EXPIRE` | §5 ("Expired" chip) |
| `TransactionType` | `DONATE` | §5 ("Donated" chip) |
| `TransactionType` | `ADJUSTMENT` | §5 (one-tap correct / clamp mechanism) |
| `ProvenanceTier` | `KNOWN_FACT` | §4 |
| `ProvenanceTier` | `ESTIMATED` | §4 |
| `ProvenanceTier` | `AI_INTERPRETATION` | §4 |
| `Actor` kind | `user` | §5 (ledger template, "you"/member name) |
| `Actor` kind | `system` | §5 (clamp row, visibly system-authored) |
| `Actor` kind | `ai-confirmed` | §4 (AI chip, post-confirm state) |
| `OverConsumptionFlag` (the clamp) | n/a, a system-generated flag, not a code union | §5 (clamp system row) |
| `ConsumptionPlan.shortfallMicros` / `skippedLots` | n/a, a numeric field, not a code union | §5 (shortfall prompt) |
| `SkippedLotReason` | `ZERO_BALANCE` | §5 (shortfall prompt context; no separate user-facing string, folded into the shortfall math) |
| `SkippedLotReason` | `NEGATIVE_BALANCE` | §5 (shortfall prompt context; unreachable in a reconciled aggregate, per the `planLotConsumption` header; internal-only, no user string) |
| `LedgerErrorCode` | `MIXED_UNITS` | §8 |
| `LedgerErrorCode` | `UNKNOWN_LOT` | §8 |
| `LedgerErrorCode` | `DUPLICATE_LOT` | §8 |
| `LedgerErrorCode` | `ZERO_DELTA` | §8 |
| `LedgerErrorCode` | `WRONG_SIGN` | §8 |
| `LedgerErrorCode` | `NOT_FINITE` | §8 (folds into the generic fallback family; a non-finite quantity cannot come from a numeric form field the client validates, so no distinct string is offered beyond the fallback) |
| `LedgerErrorCode` | `PRECISION_EXCEEDED` | §8 |
| `LedgerErrorCode` | `QUANTITY_OUT_OF_RANGE` | §8 |
| `LedgerErrorCode` | `INVALID_TIMESTAMP` | §8 |
| `LedgerErrorCode` | `TIMESTAMP_ORDER` | §8 |
| `LedgerErrorCode` | `INVALID_IDEMPOTENCY_KEY` | §8 |
| `LedgerErrorCode` | `IDEMPOTENCY_KEY_CONFLICT` | §8 |
| `LedgerErrorCode` | `INVALID_FIELD` | §8 |
| `LedgerErrorCode` | `ITEM_MISMATCH` | §8 |
| `LedgerErrorCode` | `CORRUPT_LEDGER` | §8 |

`NOT_FINITE` is listed once more here for clarity even though it was folded into the generic-fallback family rather than given its own row in §8's table; the coverage table still names it explicitly so no union member is silently missing.

---

## §10. Forbidden words

Grep gate: `safe`, `passed`, `allergen-free`, `guaranteed`, `verified safe`, a checkmark (`✓`) used as clearance, and the em dash character (Unicode U+2014) must return **zero hits in this file outside this table and its two named exceptions below.**

| Forbidden term | Why | Exception |
|---|---|---|
| `safe` | Implies a guarantee the engine cannot make (SR-1/SR-2); `ALLOWED` means "no known match", not "safe". | Two, both deliberate negations, not claims: (1) the standing caveat itself, "Known matches only. Not a guarantee this food is safe." (§3.1, §2), reused verbatim per design-direction §7's adopted wording; (2) the assistant preview's "I can't mark any food as safe" (§3.4). Both state the *absence* of a safety claim, never the presence of one. |
| `passed` | Reads as a test result ("allergen screen passed"), the exact language design-direction §7 fix #1 removed. | None. |
| `allergen-free` | A positive absence claim the engine never licenses. | None. |
| `guaranteed` / `guarantee` (as a claim) | Same failure mode as `safe`. | The one place "guarantee" appears is inside the negation "Not a guarantee this food is safe" (same string as the `safe` exception above). It is disclaiming a guarantee, not making one. |
| `verified safe` | Compounds two forbidden claims at once. | None. |
| `✓` used as clearance | A checkmark reads as "cleared" regardless of the words next to it (P9: never colour/icon-only, and never an icon that *is* the safety claim). | A checkmark may still appear as a plain UI affordance (e.g. "select" or "confirmed as entered") wherever it does not sit next to a `ScreeningVerdict`. |
| Em dash character (U+2014) | P11: reads as generated text. | None. This file must contain zero em dashes, full stop. |

---

*End of deck. Coverage: 3 `ScreeningVerdict` + 8 `UnknownReason` + 5 `WarningCode` + 3 `WarningSeverity` + 5 `EvidenceKind` + 4 `RestrictionOutcome` + 2 `RestrictionSeverity` + 8 `TransactionType` + 3 `ProvenanceTier` + 3 `Actor` kinds + 1 clamp concept + 1 shortfall concept + 2 `SkippedLotReason` + 15 `LedgerErrorCode` = 63 machine-code rows, every one resolved to a string or an explicit "no separate string, rendered through X" note.*
