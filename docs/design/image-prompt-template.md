# Image prompt template (v1, 2026-10-10)

How every recipe and ingredient image is generated, checked and shipped. Decision: [D-032](../../DECISIONS.md). Vendor: Meta Muse Image (`muse-image-1.0`), fallback OpenAI image API, pending Andy's read of Meta's commercial terms.

Bump the version at the top whenever a block below changes, and record the version in the manifest row of every image made with it.

## 1. The rules in one place

1. **Show exactly the recipe's ingredients. Add nothing.** Image models add garnish they have seen with a dish. All three vendors put sesame on miso salmon unasked.
2. **Never hide an allergen.** One image serves every household. If the recipe contains peanuts, the picture shows peanuts. A prompt never drops an ingredient because of anyone's allergy.
3. **A person checks every image before it ships** (section 5). The vendor saying "built to spec" is not a check.
4. **Images are decoration, never evidence.** Allergen information comes only from the verdict line. Alt text names the dish; it never says what the dish lacks.

## 2. Style block (goes first in every prompt)

```
Editorial food photography for a cookbook-style recipe app.
Soft natural daylight from the left, gentle shadows, cinematic but true-to-life
colour, realistic textures, shallow depth of field.
Plain matte warm-white ceramic tableware.
Not glossy, not oversaturated, no steam effects: it must look like a real
photograph, not a render.
No text, no logos, no labels, no brand packaging, no hands, no people,
no watermark.
```

Consistency comes from reference images more than from words: pass the same approved reference set (two or three images per template, listed in the manifest) on every call through Muse's reference-image anchoring.

## 3. Ingredient template (cutouts for Inventory, Shopping, mosaics)

```
{STYLE BLOCK}

Subject: {ingredient, in its usual raw or packed form, e.g.
"one raw boneless skinless chicken breast"}.
Single subject, isolated, centred, filling about 70% of the frame.
Camera 30 degrees above, three-quarter view.
Transparent background, no surface, no props, a soft contact shadow only.
Square 1:1.
If the item is normally sold in packaging, show it unbranded with no text.
```

Non-food shopping items (paper towels and similar) get an icon, not a photo.

## 4. Dish template (recipe heroes and Menu cards)

```
{STYLE BLOCK}

Subject: {recipe name}, served in a shallow warm-white ceramic bowl
on pale linen over light oak. Camera 35 degrees above, three-quarter view.
Landscape 4:3. At most two small props at the frame edge, and only items
from the ingredient list below.

Ingredients (show exactly these, nothing else):
{full ingredient list from the recipe record, verbatim}

Do not add any ingredient, garnish or topping that is not in the list above.
In particular, do not add sesame seeds, nuts, peanuts, herbs, chili,
lemon or lime unless they are listed.
Every listed ingredient that would normally be visible must be clearly visible.
```

The ingredient list is pasted from the recipe record, never retyped, so the image and the allergen screen read the same source.

## 5. Review checklist (before an image ships)

Reject and regenerate on any "no". Reject on doubt.

- [ ] Everything visible is on the ingredient list (look closely at garnish, seeds, sauces, props).
- [ ] Every listed allergen that would normally be visible is visible.
- [ ] It is clearly this dish, not a lookalike.
- [ ] No text, logos, hands or people.
- [ ] Angle, tableware and light match the reference set.
- [ ] Cutouts: clean edge on the app's paper colour, no coloured fringe at display size.

A recipe whose ingredient list changes loses its image until it is regenerated or re-reviewed.

## 6. File format and size

| | Master (kept, not shipped) | Shipped in the app |
|---|---|---|
| Ingredient cutout | PNG with alpha, as generated | **WebP with alpha**, 512 x 512, target 60 KB or less |
| Dish hero | PNG or the vendor's original, as generated | **WebP**, 1200 x 900, target 150 KB or less |

Why:
- **WebP** keeps transparency like PNG and is several times smaller. Expo and React Native display it on iOS and Android.
- **PNG** is lossless, so it is the master we regenerate sizes from. Never compress a master.
- **Not JPG** for cutouts: JPG has no transparency, so the cutout gets a solid background.
- **Not AVIF yet:** smaller still, but support across the devices we target is less certain. Revisit when the asset pipeline ticket lands.

The sizes and targets are proposed starting values for the asset pipeline ticket, not measured limits.

## 7. Manifest (one row per shipped image)

| Field | Example |
|---|---|
| file | `dish/miso-glazed-salmon.webp` |
| subject | recipe id, or ingredient name |
| ingredient list version | recipe record version the prompt was built from |
| vendor and model | Meta, `muse-image-1.0` |
| template version | v1 |
| full prompt | as sent |
| reference images | ids of the anchoring set |
| generated | date |
| reviewed by, on | name, date |

## 8. Open

- Meta commercial-use terms and data tier (D-032 condition, R-3).
- OQ-D10: offering "leave the allergen out" while cooking. Not decided; conflicts with D-017 as built.
- OQ-D11: an "illustrative photo" label on recipe images (copy deck).
