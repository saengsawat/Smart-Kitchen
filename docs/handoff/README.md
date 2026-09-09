# docs/handoff/

Per-ticket completion and review reports ([CLAUDE.md](../../CLAUDE.md) rules 28–30):

- `<TICKET>.worker.md` — the implementation worker's completion report, committed by the worker as the final commit on its ticket branch.
- `<TICKET>.review.md` — the independent reviewer's verdict and findings, committed by the architect at acceptance (reviewers stay read-only).

These are **audit records** of what was built, verified, deviated, and found — they are never a requirements source. Requirements live in tickets ([BACKLOG.md](../../BACKLOG.md)), the PRD, and ADRs.
