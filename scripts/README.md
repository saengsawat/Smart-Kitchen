# scripts/

Repo utility scripts (fixture generation, research spikes, maintenance). Empty until first need — do not accumulate one-off scripts here without a README entry explaining each.

## `food-data-coverage-research.mjs` (M1-T5, ADR-006 R-1)

Live-network research spike: measures Open Food Facts + USDA FoodData Central hit-rate and
field completeness against a realistic ~100-item US grocery basket. **Not** part of `pnpm
test` or CI — it makes real HTTP calls (rate-polite, ~1/sec to Open Food Facts; the public
`DEMO_KEY` literal to USDA FDC on a documented ~25-item subset only, respecting its
~30-requests/hour limit) and takes a few minutes to run. Run manually:

```bash
node scripts/food-data-coverage-research.mjs
```

Writes raw per-item results to `docs/research/food-data-coverage.raw.json`; the narrative
writeup (method, hit-rate tables, licensing notes, ADR-006 recommendation) is hand-authored in
`docs/research/food-data-coverage.md` from that output — the script does not write the `.md`
file. No API key is stored anywhere in this repo beyond the public `DEMO_KEY` literal in this
script.
