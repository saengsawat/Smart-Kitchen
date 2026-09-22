# Contributing

## Workflow

Trunk-based development: `main` is always releasable. Branch per ticket, keep the branch
short-lived (days, not weeks), open a PR back into `main`, and delete the branch once merged.
No long-running feature branches.

## Commits

Conventional commits, referencing the ticket they implement:

```
<type>(<ticket>): <summary>

<optional body>
```

- `type`: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, …
- `<ticket>`: the BACKLOG.md ticket ID (e.g. `M0-T2`)

Example:

```
ci(M0-T2): add GitHub Actions quality gates and CONTRIBUTING guide
```

## CI gates

Every push and every PR into `main` runs `.github/workflows/ci.yml`:

- `quality` — install (frozen lockfile — a drifted `pnpm-lock.yaml` fails the run),
  lint (including the `packages/domain` dependency-boundary rules), typecheck, test,
  format check, dependency audit (`pnpm audit --audit-level=high`)
- `secret-scan` — gitleaks

**All CI gates must pass before a PR is merged to `main`.** See the branch-protection
checklist below for how this is enforced at the repository level.

## Local setup

Requires Node.js 20+ and [pnpm](https://pnpm.io/). Enable pnpm via corepack (bundled with
Node.js):

```bash
corepack enable
corepack prepare pnpm@12.3.4 --activate
```

If `corepack enable` fails with a permissions error (seen on some Windows installs),
`npm install -g pnpm` is a fallback.

Then the four commands CI runs locally (see [README.md](README.md#development)):

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

## Running the database suites locally (M1-T10-k)

`apps/api/src/db/**`'s test files (schema constraints, append-only enforcement,
tenancy/RLS, idempotency, the ledger round-trip, telemetry, retry helper) are
gated on the `DATABASE_URL` environment variable:

- **Unset (the default):** every database suite **skips loudly** — one line on
  stderr per suite via `noteDbSuiteSkipped` (`apps/api/src/db/test-support/
  harness.ts`), plus a named `SKIP NOTICE — <suite> did not run` test in each
  file, so a green `pnpm test` run can never be mistaken for one that actually
  exercised the schema. **In CI this is not an option** — `noteDbSuiteSkipped`
  throws instead of skipping whenever `CI`/`GITHUB_ACTIONS` is set, so a
  database suite that fails to run fails the build, by name.
- **Set, pointing at a reachable Postgres 17:** every suite runs for real. Each
  test *file* creates its own throwaway database (from `template0`), migrates
  it, and drops it afterwards — safe to point at a shared server, since nothing
  here touches an existing database by name.

Any reachable Postgres 17 works; two ways to get one:

**Docker**, if you have it:

```bash
docker run --rm -d --name sk-dev-pg -p 5432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm test
docker stop sk-dev-pg
```

**A native throwaway cluster**, if you already have the PostgreSQL 17
binaries installed (no Docker required — this is what CI's own container
image and every local run of these suites during M1-T2/M1-T10 used, since
Docker is not installed on this project's primary development machine):

```bash
# Adjust PGBIN to wherever `initdb`/`pg_ctl` live (e.g. on Windows,
# "C:\Program Files\PostgreSQL\17\bin"); SCRATCH to any writable, throwaway
# directory — a temp/scratch dir, never a directory you care about, since
# initdb populates it and pg_ctl writes a log into it.
initdb -D "$SCRATCH/pgdata" -U postgres --auth=trust -E UTF8
pg_ctl -D "$SCRATCH/pgdata" -o "-p 55432" -l "$SCRATCH/pg.log" start

DATABASE_URL=postgres://postgres@localhost:55432/postgres pnpm test

pg_ctl -D "$SCRATCH/pgdata" stop
rm -rf "$SCRATCH/pgdata"
```

This does **not** touch any installed PostgreSQL service or its data
directory — it is an independent, disposable cluster on its own port, gone
with the scratch directory. Pick a port that is not already in use if `55432`
is taken locally.

## Running the mobile app locally (M3-T1)

`apps/mobile` is an Expo (managed workflow) + Expo Router app inside this
same pnpm workspace. `pnpm install` at the root covers it too, no separate
install step. To run it:

```bash
pnpm --filter mobile start
```

Full instructions, including how to load it on a phone over the same Wi-Fi
in Expo Go (no tunnel, no Expo account, no paid resource, per CLAUDE.md rule 17)
are in [apps/mobile/README.md](apps/mobile/README.md).

`pnpm --filter mobile export` is the same export smoke check CI runs as part
of the `quality` job.

## Windows: long paths

pnpm's virtual store (`node_modules/.pnpm/<pkg>@<version>_<hash>/...`) produces long,
deeply-nested paths. Combined with a deeply-nested clone location, this can exceed
Windows' classic 260-character `MAX_PATH` limit and produce misleading
`ERR_MODULE_NOT_FOUND` errors on an otherwise-correct install (seen during M0-T1 — the
scaffolding itself was fine; only a very deep clone path triggered it). If you hit this:

1. Clone into a short path (e.g. `C:\dev\smart-kitchen` rather than several directories
   deep under `AppData\Local\Temp\...`).
2. Enable long-path support:
   ```powershell
   git config --global core.longpaths true
   ```
   and enable Win32 long paths (Windows 10/11): Local Group Policy Editor →
   *Computer Configuration → Administrative Templates → System → Filesystem* →
   **Enable Win32 long paths**, or the equivalent registry key
   (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`), then restart.

## Branch protection (repo owner — manual, one-time)

`main` cannot be protected via API from this environment (no admin token). Apply this by
hand in **GitHub → Settings → Branches → Add branch protection rule** (branch name pattern
`main`):

- [ ] **Require a pull request before merging** (require approvals: at least 1 is
      reasonable for a solo/small repo; adjust as the team grows)
- [ ] **Require status checks to pass before merging**, and select these two checks by
      their exact job names (they only appear in the list after the workflow has run at
      least once on the repo):
  - `quality`
  - `secret-scan`
- [ ] **Require branches to be up to date before merging** (recommended, keeps the above
      checks meaningful)
- [ ] **Do not allow bypassing the above settings** (or at minimum, uncheck any
      "allow specified actors to bypass" for force pushes)
- [ ] **Block force pushes** — under "Rules applied to everyone", ensure
      "Allow force pushes" is **unchecked**
- [ ] **Restrict deletions** — ensure "Allow deletions" is **unchecked** for `main`
      (demo branches other than `main` remain deletable, which is required for the
      demo-branch cleanup workflow in ticket M0-T2)
