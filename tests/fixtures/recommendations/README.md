# `tests/fixtures/recommendations/`

Fixture corpus for the recommendation path, per
[testing-strategy.md §3](../../../docs/architecture/testing-strategy.md).

Today it holds **allergen screening cases** (`screening-*.json`), added by
M1-T4. The directory is also the home testing-strategy §3 designates for
generation contexts and recorded LLM outputs (valid / malformed /
prompt-injection) when recipe generation lands in M6 — hence the filename
prefix, which leaves room for `generation-*.json` beside these.

## Why these files exist

They are the durable, language-neutral statement of what the deterministic
allergen engine must decide. `packages/domain/src/allergens/fixtures.test.ts`
reads every file in this directory and asserts the engine reproduces
`expect` exactly, so a case added here is automatically enforced. The same
corpus is intended to drive the M6 eval tests (INV-ALRG-1 end-to-end), which is
why the expectations are expressed as data rather than as assertions in code.

## Case schema

```jsonc
{
  "caseId": "screening-002-peanut-recipe-blocked", // must equal the filename stem
  "category": "valid | allergen-violating | adversarial | missing-data",
  "title": "one-line description",
  "notes": "why this case exists / what it protects",
  "input": {
    "subject": { /* ScreeningSubjectInput: kind RECIPE or PRODUCT */ },
    "members": [ /* ScreenedMember[] */ ]
  },
  "expect": {
    "verdict": "BLOCKED | ALLOWED_WITH_UNKNOWNS | ALLOWED", // household verdict
    "memberVerdicts": { "m-alex": "BLOCKED" },
    "outcomes": { "r1": "MATCH" },          // by restrictionId
    "evidenceKinds": ["NAME_TERM"],         // sorted, de-duplicated
    "unknownReasons": ["NO_ALLERGEN_DATA"], // sorted, de-duplicated
    "warningCodes": ["NO_SAFETY_GUARANTEE"] // sorted, de-duplicated
  }
}
```

`evidenceKinds`, `unknownReasons` and `warningCodes` are compared as **exact
sets**, so an unexpected new warning or a silently dropped unknown fails the
suite rather than passing unnoticed.

## Adding a case

Reproduce the situation as a new file (bug ⇒ fixture first, per testing-strategy
§3), then run `pnpm test`. Note that `expect` records *current, intended*
behavior: two entries — `screening-006`/`screening-007` — encode the **PROPOSED**
cross-contact policy, and will need updating if the architect ratifies the
alternative. Both say so in their `notes`.

## Rules (from testing-strategy §3)

- Synthetic or rights-cleared only. No real user data, no scraped content.
- Never state a food is safe: `ALLOWED` in these files means *no known match*.
