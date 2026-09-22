# Andy + Dean session, 2026-09-21: outcomes and open threads

Recorded by the architect from Andy's report the same day. Anything marked PROPOSED here is the architect's recommendation, not a decision; decisions move to [DECISIONS.md](../../DECISIONS.md) when Andy confirms.

## Agreed

1. **Proceed with the product shape shown in prototype v3** ([smart-kitchen-prototype.html](../design/mockups/smart-kitchen-prototype.html), walkthrough deck [KitchenSmart-prototype-review.pdf](../design/mockups/KitchenSmart-prototype-review.pdf)). Dean will send a list of additional functions later. D-002 (MVP scope) is therefore agreed in principle but **not ratified** until that list is in and triaged.
2. **Four tabs locked:** Home, Inventory, Add food (centre scan button), Shopping.
3. **Fifth tab changes from "Recipes" to a Menu page.** Dean's intent: users can set up a menu on the spot or ahead of time (Monday menu, weekend menu, next three days), see recommended menus based on what is in stock, and open recipes from there. Anything a recipe needs that is not on hand can be pushed to the shopping list, by the user or by the AI. Recipes become a subset of the Menu page. Recorded as **D-020 (PROPOSED)**.

## Raised, not settled

4. **Home page depends on user state.** A brand-new user has no inventory and no preferences, so the dashboard with recommendations cannot be the first thing they see. Andy asked whether to design page by page first and revisit prerequisites (food preferences, cuisine types, stock) later. Architect view below and in **OQ-D9**.

## Not covered (still open from the decision brief)

A2 launch market, A3 household permissions, A4 auth approach, A5 hosting, A6 Expo, A7 stubbed-auth M2, A8 label-data tier, A9 shortfall policy, A10 name and UX opens, A11 imagery, A12 token darkenings. See [decision-brief-2026-09.md](decision-brief-2026-09.md). Andy to confirm which of these were discussed.

## Architect notes

**On the Menu page (D-020).** Good fit with the brief's closed loop (Inventory, Recommendations, Meal Plan, Shopping List) and with the domain model, where MealPlan was deferred rather than rejected. It does pull multi-day meal planning into the MVP, which D-002 had deferred, so it is a real scope add: new entities (MealPlan, MealSlot), two or three new screens, and shopping gaps computed from planned meals as well as tonight's pick. Recommendation: keep the tab, ship it in two layers.

- Layer 1 (MVP): the tab opens on "Tonight", which is today's Recipes screen renamed. Recommended menus from inventory, recipe detail, cook confirm, push missing items to Shopping.
- Layer 2 (fast-follow, same tab): "Plan ahead" with named menus and day slots. The data model carries MealPlan from the first M2 ticket so layer 2 needs no migration of user data.
- Rules that carry over: gap math and allergen verdicts stay deterministic (CLAUDE.md rule 7); the AI may suggest a menu or a substitution, but adding to the shopping list is the deterministic gap function, and a planned menu that is blocked for a member is shown, never selectable (P5).
- Naming: "Menu" reads as a restaurant menu to some users; "Meals" or "Plan" are alternatives. Dean's call, no engineering weight.

**On the home page and prerequisites (OQ-D9).** Andy is right that one dashboard cannot serve everyone. The prototype already has the first-run state ("Your kitchen is empty, scan your first item"). Recommendation: do not front-load a questionnaire. Required onboarding stays minimal and is already designed: household (S1) and allergies (S2), because allergies are the safety gate. Everything else is progressive: home shows scan-first until there are items, inventory-first until there are enough items to recommend from, and the full dashboard after that. Preferences and cuisines are asked the first time a recommendation would use them, with a skip. This is the standard activation pattern and it keeps the correction-rate hypothesis honest: we learn whether people maintain inventory before we ask them for anything else. So yes, build page by page, but write the home-state table (empty, sparse, ready) and the minimum-onboarding rule down as a short M3-E0 design ticket before the Home build ticket, not after.

## Follow-ups

- Dean: list of additional functions. Architect triages each as MVP, fast-follow or later against D-002 and the cost map.
- Andy: confirm which brief items (A2 to A12) were decided; confirm the tab name.
- Architect: on Dean's list, update ux-plan §1 (five-tab shell), MVP_PRD §3, domain-model (MealPlan), and write the M3-E0 tickets for the Menu tab and home states.
