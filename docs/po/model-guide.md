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

## When to start a new architect session

Type `/context` in Claude Code to see how big the session is.

| Context size | What to do |
| --- | --- |
| Under 150k | Keep going |
| 150k to 250k | Finish the current ticket, then start a new session |
| Over 250k | Start a new session as soon as the current step is done |

Better than any number: start fresh after every accepted batch. Everything is
saved in STATUS, the tickets and the handoff files, so nothing is lost, and the
new session starts at about 30k to 50k. On 2026-10-03 the architect reached
597k, two to four times past where it should have restarted.

## When the architect is mid-batch

Going over 250k now and then to finish a batch is fine. Stopping halfway costs
more than finishing. The workers' and reviewers' tokens don't add to the
architect's context; only what they send back does. To keep it from growing in
the first place, `/next` tells the architect to:

- take at most 3 tickets per session,
- ask agents for short chat summaries and keep the full reports in
  `docs/handoff/` files,
- stop after the batch is accepted and tell you to start a fresh session.
