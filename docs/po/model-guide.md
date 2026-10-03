# Which model to use

Andy's quick reference, written 2026-10-03. The binding rules are CLAUDE.md
rules 23, 24, 24a, 24b and 28a; this page is the plain-English version.

| Role | Model | Effort |
| --- | --- | --- |
| Architect (default) | Opus 5.5 | Medium |
| Architect for a planning day (writing tickets, ADRs, big decisions) | Opus 5.5 | High, picked when you start that session |
| Workers and reviewers, routine work | Sonnet | Medium (already set) |
| Workers and reviewers, risky work (inventory math, allergens, login/permissions, database) | Opus 5.5 | Medium (already set) |
| Hard bugs | Opus 5.5 via `sk-investigator` | High (already set) |
| Fable | Only for a rare, very important call | Don't use it as the architect |

## Why Opus on medium for the architect

- **Not Sonnet.** The architect makes product and architecture calls and does
  the detailed code check on risky tickets. Those need Opus judgment.
- **Medium, not high.** Most of an architect day is routine: dispatching,
  reading reports, updating docs. High effort spends more thinking on every
  step for little gain. The hard thinking happens in the agents it sends out.
- **Not Fable.** On 2026-10-03 the architect ran on Fable at 566k context.
  That's the most expensive mix there is.

## Session habits

- Pick the model and effort when you start a session. Don't switch mid-session;
  it breaks the cache and the next step pays full price.
- Start a new session per batch of work with `/next`. A long session re-sends
  its whole history on every step, so it gets more expensive the longer it runs.
- Going away for more than about an hour? Type `/compact` first, or start a
  new session when you're back.
