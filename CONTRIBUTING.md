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
corepack prepare pnpm@12.3.1 --activate
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
