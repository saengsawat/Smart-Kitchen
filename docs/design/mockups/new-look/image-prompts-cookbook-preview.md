# Image prompts: Cookbook (B) preview

Built from [image-prompt-template.md](../../image-prompt-template.md) v1 (D-032). Covers the preview's Home, Inventory, Menu, Shopping and Recipe detail screens: 14 ingredient cutouts and 4 dish photos, 18 images in all.

## How to run them

1. **One prompt per image.** Paste each block as is into Meta AI (or Muse). Don't combine them.
2. **Do the style anchors first.** Generate `ing-strawberries` and `dish-chicken-spinach-stir-fry` first. When you like them, attach them as references for the rest, with: *"Match the lighting, angle, tableware and style of the attached image."* That does more for consistency than any wording.
3. **Check each one** against its ingredient list before saving (template section 5). Reject anything showing an item not on the list.
4. **Save** the master in `docs/design/Sample AI images/preview/` under the exact file name given. PNG for cutouts. PNG or JPG for dishes.

**Sizes.** Ask for the largest the tool gives, at the stated shape: square 1:1 (1024 x 1024 or bigger) for cutouts, landscape 4:3 (1600 x 1200 or bigger) for dishes. If the tool can't set exact pixels, the shape is what matters. I convert the masters to the app sizes (WebP, 512 x 512 cutouts, 1200 x 900 dishes).

**Recipe ingredient lists below are mockup fixtures** I wrote to match v5's data and verdicts. They are not real recipe records. Two of them are deliberate for the allergen states:
- **Granola** is specified as plain oat with no nuts or seeds. Most granola has nuts or sesame, and the parfait's verdict is "no known allergen match" for Maya.
- **Thai peanut noodles** must show peanuts. It's the blocked recipe, so the photo has to show the reason.

---

## Ingredient cutouts (14). Square 1:1, transparent background, PNG

### ing-strawberries.png (style anchor)
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: a small loose pile of five fresh whole strawberries, two with green tops showing.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-chicken-breast.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: one raw boneless skinless chicken breast.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-spinach.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: a loose handful of fresh baby spinach leaves.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-mushrooms.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: a small pile of whole fresh cremini (brown) mushrooms, one cut in half.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-greek-yogurt.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: thick plain Greek yogurt in a small matte warm-white ceramic bowl, with a soft swirl on top. Nothing on the yogurt.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-eggs.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: three whole brown eggs grouped together, no carton.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-salmon-fillets.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: two raw skin-on salmon fillets side by side. No herbs, no lemon, no seasoning.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-basmati-rice.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: uncooked long-grain basmati rice in a small matte warm-white ceramic bowl.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-olive-oil.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: a plain clear glass bottle of golden olive oil with a simple cork stopper. Completely unlabelled, no text, no brand.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-broccoli.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: one fresh raw broccoli crown.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-garlic.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: one whole garlic bulb with two loose cloves beside it.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-granola.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: plain toasted oat granola clusters in a small matte warm-white ceramic bowl. Oats only: no nuts, no seeds, no sesame, no dried fruit, no chocolate.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-soy-sauce.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: a small plain clear glass cruet of dark soy sauce. Completely unlabelled, no text, no brand.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

### ing-miso.png
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: a spoonful of pale white miso paste in a small matte warm-white ceramic dish. Nothing sprinkled on it.
Single subject, isolated, centred, filling about 70% of the frame. Camera 30 degrees above, three-quarter view. Transparent background, no surface, no props, a soft contact shadow only. Square 1:1, PNG with transparency.
```

Paper towels (a Shopping row) gets an icon, not a photo.

---

## Dish photos (4). Landscape 4:3, PNG or JPG

### dish-chicken-spinach-stir-fry.png (style anchor)
Verdict in the preview: no known allergen match, 2 members.
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Plain matte warm-white ceramic tableware. Not glossy, not oversaturated, no steam effects: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: chicken and spinach stir-fry served over basmati rice in a shallow warm-white ceramic bowl, on pale linen over light oak. Camera 35 degrees above, three-quarter view. Landscape 4:3. At most two small props at the frame edge, and only items from the ingredient list below.

Ingredients (show exactly these, nothing else):
sliced chicken breast, baby spinach, sliced cremini mushrooms, cooked basmati rice, garlic, soy sauce, olive oil.

Do not add any ingredient, garnish or topping that is not in the list above. In particular, do not add sesame seeds, nuts, peanuts, herbs, chili, scallions, lemon or lime. Every listed ingredient that would normally be visible must be clearly visible.
```

### dish-yogurt-berry-parfait.png
Verdict: no known allergen match, 2 members.
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Plain matte warm-white ceramic tableware. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: a yogurt berry parfait layered in a short clear glass, on pale linen over light oak. Camera 35 degrees above, three-quarter view. Landscape 4:3. At most two small props at the frame edge, and only items from the ingredient list below.

Ingredients (show exactly these, nothing else):
plain Greek yogurt, sliced fresh strawberries, plain toasted oat granola.

Do not add any ingredient, garnish or topping that is not in the list above. In particular, do not add nuts, seeds, sesame, honey, mint, other berries or chocolate. The granola is oats only. Every listed ingredient that would normally be visible must be clearly visible.
```

### dish-miso-glazed-salmon.png
Verdict: allergen data incomplete for Maya, severe sesame allergy. The miso has no ingredient statement on file. The photo must not show sesame: it isn't in the recipe.
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Plain matte warm-white ceramic tableware. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: one miso-glazed salmon fillet with roasted broccoli and basmati rice on a shallow warm-white ceramic plate, on pale linen over light oak. Camera 35 degrees above, three-quarter view. Landscape 4:3. At most two small props at the frame edge, and only items from the ingredient list below.

Ingredients (show exactly these, nothing else):
salmon fillet, white miso paste, soy sauce, garlic, roasted broccoli, cooked basmati rice.

Do not add any ingredient, garnish or topping that is not in the list above. In particular, do not add sesame seeds, scallions, chili, herbs, nuts, lemon or lime. Every listed ingredient that would normally be visible must be clearly visible.
```

### dish-thai-peanut-noodles.png
Verdict: BLOCKED for Maya (contains peanut). The peanuts must be clearly visible.
```
Editorial food photography for a cookbook-style recipe app. Soft natural daylight from the left, gentle shadows, cinematic but true-to-life colour, realistic textures, shallow depth of field. Plain matte warm-white ceramic tableware. Not glossy, not oversaturated: it must look like a real photograph, not a render. No text, no logos, no labels, no hands, no people, no watermark.

Subject: Thai peanut noodles in a shallow warm-white ceramic bowl, on pale linen over light oak. Camera 35 degrees above, three-quarter view. Landscape 4:3. At most two small props at the frame edge, and only items from the ingredient list below.

Ingredients (show exactly these, nothing else):
flat rice noodles, creamy peanut sauce, crushed roasted peanuts scattered on top, sliced scallions, julienned cucumber, lime wedge.

Do not add any ingredient, garnish or topping that is not in the list above. In particular, do not add sesame seeds, chili, cilantro or other herbs. The crushed peanuts must be clearly visible on top. Every listed ingredient that would normally be visible must be clearly visible.
```

---

## Checklist when you're done

18 files in `docs/design/Sample AI images/preview/`:

- [ ] ing-strawberries, ing-chicken-breast, ing-spinach, ing-mushrooms, ing-greek-yogurt, ing-eggs, ing-salmon-fillets
- [ ] ing-basmati-rice, ing-olive-oil, ing-broccoli, ing-garlic, ing-granola, ing-soy-sauce, ing-miso
- [ ] dish-chicken-spinach-stir-fry, dish-yogurt-berry-parfait, dish-miso-glazed-salmon, dish-thai-peanut-noodles

Tell me when they're in and I'll convert them and build the preview.
