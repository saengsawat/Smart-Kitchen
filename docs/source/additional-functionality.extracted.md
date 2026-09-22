# Additional functionality for Smart Kitchen (extracted text)

**Source:** `Additional functionality for Smart Kitchen.docx` in this directory, from Dean (product originator), received 2026-09-22 via the PO. The DOCX is canonical and unaltered; this file is a plain-text extraction for agent readability, produced the same way as `product-brief.extracted.md`. Per CLAUDE.md rule 2 this document is authoritative for product intent only, not for architecture or MVP scope. Architect triage: [docs/po/dean-additions-2026-09-22.md](../po/dean-additions-2026-09-22.md).

---

Additional functionality for Smart Kitchen:

- Ability to move an item
  - Refrigerator > Freezer
  - Freezer > Refrigerator
- Ability to Delete / Trash an Item. (Add, Change, Delete functionality). Adding can be done via several ways:
  - User Entry with search capability. Single Entry.
  - Pic of Pantry / Refrigerator with AI recognition. Multiple Entries.
  - Execution of a Shopping List. Multiple Entries.
- Weekly Menu Planning functionality drives Shopping List. For example, if Menu Planning has an up-coming meal of Pancakes for Breakfast and Grilled Cheese for lunch >> If Pancake Maple Syrup and American Cheese are not in inventory, AI logic adds them to the shopping list (Blue Item)
- If Menu Planning (Time Phased by Day of Week) has items in Freezer, issue a Defrost Warning 2 days prior.
- Need functionality within Menu Planning to save FAV Meals.
- Recipes button becomes Menu Planning.
- When a shopping list is "Executed in Full" it should be added to Inventory as follow
  - Dry goods in Pantry
  - Frozen Goods in Freezer
  - Cold goods in Refrigerator
- Shopping List should be color coded in a manner similar to:
  - Green > User Requested
  - Blue > Added by APP/AI Logic to support a Menu Planning meal.
- User should be able to set a "Safety Stock" of x number of units are maintained before adding to shopping list. For Example, If I want to always have 4 cans of Tuna on hand, when Tuna inventory drops below 4 cans, it is added to shopping list.
- Possible Coupon notification for stores shopped (Phase II ?) for items on shopping list ?
- Warning for User Allergies on shopping list
- Fav Meals with ability (User Config. User can toggle on/off this functionality) to suggest healthier choices / alternatives driven by AI.
- Having a user configuration for UOM (unit of measure), US or Metric
