# No raw file here

`foodkeeper.json` is not present in this directory. The download was attempted and
blocked this session (Akamai edge "Access Denied" on the entire `fsis.usda.gov` host,
tried with three different HTTP clients). Full detail, the exact URL, the licence and
the next step are recorded in `tests/fixtures/shelf-life/README.md` one level up.

This file exists only so the empty `raw/` directory is not mistaken for an oversight,
and is not fixture data of any kind. Delete it the same commit a real
`foodkeeper.json` lands here.
