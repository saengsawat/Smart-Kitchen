# Dean's diet list and menu-driven shopping (received 2026-10-07, PO calls 2026-10-08)

**Source:** Dean's message to Andy, relayed in chat on 2026-10-07 (quoted below as received). **Decisions:** D-031 (diets), D-024 addendum (rows 6 and 10, Plan ahead in MVP), both in [DECISIONS.md](../../DECISIONS.md).

## Dean's message (verbatim)

> Can we have the Menu planning functionality allow for custom entries as well as selection of the following diets:
>
> Mediterranean Diet, DASH Diet, MIND Diet, Ketogenic (Keto) Diet, Atkins Diet, Carnivore Diet, Dukan Diet, Vegetarian Diet, Vegan Diet, Flexitarian Diet, Paleo Diet, Whole30, Gluten-Free Diet, Intermittent Fasting, The Zone Diet, WeightWatchers (WW)
>
> Then based on menu planning selections, the shopping list will reflect requirements for shopping. Again it should color code what is driven by menu planning vs shopping list entries from user requests. I think this along with allergy alerts are critical functionality for initial release.

## Where each ask stood on 2026-10-07

| Ask | Status before | Source |
|---|---|---|
| Diet picker plus custom entries | SOURCE REQUIREMENT in part (the brief lists Mediterranean, low carb, keto, vegetarian, vegan, high protein, low sodium, heart healthy, diabetic-friendly, gluten-free, dairy-free, user-defined); PRD MVP has "dietary preferences (basic), soft ranking signals only"; S2 onboarding already has an optional Preferences block with three chips (Vegetarian, High protein, Kid-friendly; copy-deck §11, `apps/mobile/app/onboarding/allergies.tsx`), one shared block for MVP, per member in S12; Dean's named diets are not designed or built | brief "Dietary Preferences"; MVP_PRD §4; copy-deck §11 |
| Menu selections drive the shopping list | Covered by D-020 and D-024 row 6; "Add missing to Shopping" in the prototype; but the multi-day "Plan ahead" layer was recommended as fast-follow and the PRD listed multi-day planning under DEFER | D-020; dean-additions row 6 |
| Colour code menu-driven vs user-added rows | Every shopping row already stores and shows its origin (menu tag, AI chip, member initials; M3-T5); the colour band is D-024 row 10, still open with Dean | dean-additions row 10 |
| Allergy alerts critical | MVP core; server-side screening (M2-T4) waits on A3; shopping-row allergen warnings are a recommended MVP add (D-024) | MVP_PRD §9; A3 |

## PO calls (Andy, 2026-10-08)

1. **Plan ahead moves into MVP.** Multi-day menu planning that pushes missing ingredients to Shopping is in the first release (D-024 addendum; D-020 consequence).
2. **Diets: the sorted list** (D-031):

| Diet | How the app treats it |
|---|---|
| Gluten-free | Not a diet entry for coeliac safety: it routes to the allergy profile (D-026 maps OFF `en:gluten` to `wheat` and keeps the raw tag). The diet picker may show "Gluten-free" but selecting it offers to add the allergy, with the allergy safety copy. |
| Vegetarian, Vegan | Soft preference now; a deterministic check becomes possible once ingredients carry a category (later ticket). |
| Mediterranean, Keto, Atkins, Carnivore, Dukan, Flexitarian, Paleo, Whole30, Zone | Soft guidance to the recipe and menu suggestions (prompt context and ranking signal only). |
| DASH, MIND | Soft guidance; copy names the diet only and never describes a health effect. |
| Intermittent fasting | Not a food filter: an eating window that shapes which meal slots Plan ahead offers. |
| WeightWatchers (WW) | Not offered as a named option (trademark, proprietary points). A user can type it as a custom entry; no points arithmetic anywhere. |
| Custom entries | Free text, stored as typed, passed to the AI as untrusted data (never instructions, MVP_PRD §11), soft only. |

Copy rule for every diet: the app says a recipe or menu was chosen "with your preferences in mind" style wording; it never says a recipe "is compliant", "is keto", "is safe" or makes a health claim. Exact strings come from the copy deck via M3-E0-T5.

## Still open

- **Row 10 colour band (Dean):** chips and tags are built; does he also want a coloured left band? If yes it uses the palette (terracotta tint = menu, purple = AI, neutral = member), not literal green and blue, and colour is never the only signal (P9). M3-E0-T5 shows the band behind a prototype switch so Dean can compare.
- The other D-024 rows and A3 (A3 still gates the server-side allergy screening Dean calls critical).
