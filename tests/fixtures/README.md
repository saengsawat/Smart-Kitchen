# Test fixtures

Synthetic/rights-cleared fixture data so development and CI never depend on live APIs. Layout and rules are defined in [docs/architecture/testing-strategy.md §3](../../docs/architecture/testing-strategy.md#3-fixtures-strategy-testsfixtures) — read that before adding fixtures.

Subdirectories (created as their first fixtures land, starting M1-T4/T5):
`products/` · `barcodes/` · `receipts/` · `inventories/` · `recommendations/` · `nutrition/`

Rules (summary): no real user data; no scraped content; receipt images PII-scrubbed; every provider port has a fixture-backed implementation reading from here; production bugs get reproduced as fixtures first.
