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
| `liquid-per-100ml-ripple.json` | 855643006045 | Ripple Dairy-Free Milk | M3-T4e: the same product as `unparseable-quantity-ripple.json`, re-captured from staging with `nutrition_data_per` added to the field list; its real value is `"100ml"`, proving the adapter emits no `PER_100G` profile for a genuine per-100-ml liquid record |

Nine requests went to OFF in total while preparing these (one staging probe,
one production search to pick candidates, seven product reads), all
sequential and several seconds apart. To add a recording, capture it the same
way, label it, and never hand-edit the body.

**M3-T4e addition (2026-09-29):** two more requests to the staging host, both
within the ticket's "at most two" budget: one throwaway connectivity check
(`fields=code` only, not saved as a fixture) and one real capture of
`liquid-per-100ml-ripple.json` above, with the updated field list that now
includes `nutrition_data_per`.

**M2-T4b addition (2026-09-30):** two recordings, both captured by hand from
the staging host (`https://world.openfoodfacts.net`) with the field list that
now includes `product_name_en`, bodies unedited:

| File | Code asked | Product | Why it is here |
| --- | --- | --- | --- |
| `upc-e-graham-crackers.json` | 044000004637 | Honey Maid Graham Crackers | its UPC-A compresses to the UPC-E `04446307`; the API expands the UPC-E and asks OFF for this code. Its real tags include `en:gluten` (mapped to wheat, D-026) and `en:soybeans` |
| `english-name-only-indomie.json` | 5285000396437 | Indomie | `product_name` is empty on staging, only `product_name_en` is set (fallback before not-found) |

Requests by hand for this ticket: 6 staging product reads (2 kept as
recordings; 3 candidates rejected (a Skittles record whose UPC-E collided with the EAN-8 check; two products whose staging copy already had a main-language
name), plus 1 connectivity check),
1 staging search, and 9 production searches to pick candidates (one answered 503 and was not retried). Never more than
one in flight.
