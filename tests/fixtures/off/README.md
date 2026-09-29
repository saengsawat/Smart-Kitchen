# Recorded Open Food Facts responses (M2-T4a)

Real responses from the OFF v2 product endpoint, captured once by hand on
2026-09-29 from production (`https://world.openfoodfacts.org`) with the
default User-Agent (`SmartKitchen/0.1 (development; https://github.com/saengsawat/Smart-Kitchen)`).
The automated suite replays them through a stub `fetch`; it never opens a
connection to OFF (rule 18).

Each file is `{ capture, body }`. `capture` is ours (date, host, exact request
path and query, HTTP status, content type, a note). `body` is OFF's JSON
exactly as it arrived, re-serialized with two-space indentation; no field was
added, removed or edited.

| File | Code asked | Product | Why it is here |
| --- | --- | --- | --- |
| `full-peanut-butter.json` | 096619555505 | Kirkland Organic Creamy Peanut Butter | full record: CONTAINS and MAY_CONTAIN tags, `en:coconut` in traces, clean quantity |
| `traces-only-granola.json` | 856416000703 | Bear Naked Triple Berry Crunch Granola | `allergens_tags` empty, traces only |
| `unmapped-tags-bread.json` | 013764027138 | Dave's Killer Bread 21 Whole Grains and Seeds | `en:gluten` (deliberately unmapped) and non-taxonomy tags `en:Grains`, `en:Seeds` |
| `unparseable-quantity-ripple.json` | 855643006045 | Ripple Dairy-Free Milk | `quantity` "48 fl oz", which the unit registry does not support |
| `no-allergen-fields-almond-breeze.json` | 041570056189 | Blue Diamond Almond Breeze | requested with a field list that omits `allergens_tags` and `traces_tags`, so the real response has no allergen field |
| `sparse-sandwich.json` | 0999999999993 | a store sandwich | meant as a not-found probe, but OFF had it: no quantity, no ingredients, no categories |
| `not-found.json` | 481293740567 | none | HTTP 404 with `status: 0` |

Nine requests went to OFF in total while preparing these (one staging probe,
one production search to pick candidates, seven product reads), all
sequential and several seconds apart. To add a recording, capture it the same
way, label it, and never hand-edit the body.
