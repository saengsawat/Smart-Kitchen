# tests/fixtures/shelf-life/

Fixture home for the USDA FoodKeeper dataset (R-6 / ticket in progress toward M8-T1).
Per CLAUDE.md rule 18, live provider calls are never required for `pnpm test`; this
directory exists to hold one committed, unmodified raw file plus this README (source,
retrieval date, format, checksum, licence). **As of this commit, no raw file is
present.** The download could not be completed this session. This is disclosed here,
not papered over (CLAUDE.md rule 19), and `raw/` currently holds only
`NOT_RETRIEVED.md` explaining why.

## Dataset identity (verified, 2026-09-30)

- **Title:** "FSIS - FoodKeeper Data"
- **Publisher:** Food Safety and Inspection Service (FSIS), U.S. Department of Agriculture
- **Catalog record (read successfully, 2026-09-30):** <https://catalog.data.gov/dataset/fsis-foodkeeper-data>
- **Declared resource URLs** (from the catalog record's own resource list; English is the
  only language this ticket needs, Spanish/Portuguese exist too):
  - JSON: `http://www.fsis.usda.gov/shared/data/EN/foodkeeper.json`
  - XLS: `http://www.fsis.usda.gov/shared/data/EN/FoodKeeper-Data.xls`
- **Dataset First Published:** November 10, 2020
- **Dataset Last Updated (catalog `modified` field):** 2025-01-22
- **Access Level:** public
- **Also referenced by the catalog page:** a data-documentation PDF at
  `http://www.fsis.usda.gov/wps/wcm/connect/e43b0732-aeec-4150-84df-10968ae4ed95/Data-Documentation-FoodKeeper-Application.pdf?MOD=AJPERES`
  (also unreachable this session, see below).

## Licence (verbatim from the catalog record's structured metadata)

Read directly from the "license" field and the sidebar's "Access & Use" panel on
`catalog.data.gov`'s dataset page, both showing the same value:

> license: https://creativecommons.org/publicdomain/zero/1.0/

That URL is the **Creative Commons CC0 1.0 Universal (Public Domain Dedication)**.
The sidebar separately lists **Access Level: public**. Nothing on the catalog page asks
for an account, an API key, acceptance of any additional terms, or payment to obtain
the data — CLAUDE.md rule 17's stop condition ("if it requires an account, an API key,
acceptance of terms beyond a public-domain or open statement, or any payment, STOP")
is **not triggered** by anything the source itself asks for. The blocker below is a
network-access failure, not a licensing or authorization gate.

## Retrieval attempt (2026-09-30) — BLOCKED, no file obtained

Every resource URL above, plus the bare `https://www.fsis.usda.gov/` root page and
`https://www.foodsafety.gov/keep-food-safe/foodkeeper-app` (a second USDA-family
property hosting the same FoodKeeper data as a web app), was requested from this
session's network using:

- `curl` with a descriptive research User-Agent
  (`SmartKitchenApp-ResearchSpike/0.1 (R-6; contact: research@smartkitchen.local)`),
  matching the R-1 script's politeness convention.
- `curl` with a generic browser User-Agent.
- Node's built-in `fetch` (a different HTTP client/TLS stack than curl), to rule out a
  client-specific fingerprint block.

**Every one of those requests returned the same result:** `HTTP/1.1 403 Forbidden`,
`Server: AkamaiGHost`, body:

```
<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>

You don't have permission to access "..." on this server.<P>
Reference #18.7fcda17.<timestamp>.<hex>
<P>https://errors.edgesuite.net/18.7fcda17.<timestamp>.<hex></P>
</BODY>
</HTML>
```

This is Akamai's edge-level "Access Denied" page, returned even for the bare domain
root with no query path at all — i.e. this is not specific to the `.json` resource, not
a rate limit (it was the very first request, not a repeated one), and not a challenge
page asking for a login or a key. It is a categorical block of this session's egress
address/range by USDA's CDN, most consistent with a known, common pattern of U.S.
federal sites blocking traffic from cloud/datacenter IP ranges outright. By contrast,
`https://catalog.data.gov/dataset/fsis-foodkeeper-data` (a **different** host, GSA's
newer catalog frontend, not fronted by the same Akamai property) answered `200 OK` to
the identical client throughout — confirming the block is host-specific to the
`fsis.usda.gov` / `foodsafety.gov` family, not a general loss of internet access in this
session.

A CKAN-style mirror of the same catalog record was also checked
(`data.amerigeoss.org/dataset/fsis-foodkeeper-data1`, an open-data mirror site) purely
to see whether it hosted its own copy of the file rather than linking out — it does not;
every one of its resource entries points back to the same blocked `fsis.usda.gov` URLs.
No other official host for this dataset was found.

**What was deliberately not done:** several unofficial third-party GitHub repositories
surfaced in search results claiming to package FoodKeeper data (e.g. small hobby projects
that import or re-serve it). None of those were downloaded or used as a substitute. This
ticket names one specific source ("the USDA FoodKeeper dataset (FSIS; published on
data.gov and as the FoodKeeper app's data)"); an unofficial third-party copy cannot be
checksum-verified against that source while the source itself is unreachable, so
substituting one would trade a disclosed gap for an unverifiable and undisclosed one.
That is a **RESEARCH REQUIRED** judgment call, not a decision — flagged in
`docs/handoff/R-6.worker.md` for the architect.

## Checksum

None. No file was retrieved, so there is nothing to hash. `raw/NOT_RETRIEVED.md`
records this same fact so the empty directory is not mistaken for an oversight.

## What this means for the rest of the ticket

Objective (a) is half done: the source, its exact URLs, retrieval date, and licence are
located and verified; the download itself did not succeed. Objectives (b) (coverage
measurement) and (c) (data-shape description) that require reading the actual dataset
are **BLOCKED / not measured this session** — see `docs/research/shelf-life.md` §5,
which reports this as a gap rather than estimating numbers to fill it, the same way
`docs/research/food-data-coverage.md` §5 reported FDC's rate-limit gap in R-1.

## Next step (for the architect / PO)

Retry the same two URLs from a network egress not subject to this block (for example,
Andy's own machine, or a CI runner with a different address range), or obtain the file
through another approved channel and commit it here; then re-run
`scripts/shelf-life-coverage-research.mjs`, which already does the local-corpus half of
the work (reading `tests/fixtures/products/**` and the nine Chen seed items) and is
written to pick up the FoodKeeper file the moment it exists at
`tests/fixtures/shelf-life/raw/foodkeeper.json`.
