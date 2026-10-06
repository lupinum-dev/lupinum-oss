# Lupinum OSS

The public standard for Lupinum libraries: the handbook (`docs/`, published at
https://oss.lupinum.com), repository starters (`starters/`), the read-only
audit (`scripts/audit.mjs`), the agent skill (`skill/lupinum-oss/`) and the
list of governed repositories (`fleet/libraries.json`). This repository does
not publish to npm.

## Commands

```bash
pnpm install
pnpm dev                          # handbook at the URL Nuxt prints
pnpm verify                       # exactly what ci.yml runs: pnpm audit, pnpm test, pnpm build
pnpm audit:repos                  # audit every repository in fleet/libraries.json (read-only, uses gh)
pnpm audit:repos OWNER/REPO       # audit one repository
node scripts/audit.mjs --local ../some-repo   # file checks only, no GitHub access
node scripts/verify-starters.mjs [library|library-monorepo|nuxt-module]   # generate and verify starters (slow)
```

`pnpm audit` is pnpm's dependency audit; the repository audit is `pnpm audit:repos`.
Run `verify-starters.mjs` when you change `starters/`; the starter smoke workflow runs it too.

## Hard rules

- Never push to `main`; open a pull request. Never publish anything.
- The audit only reads. Do not add code that changes GitHub, npm or Vercel settings.
- Keep tooling lean: a check or script is allowed only if it guards behavior a
  user relies on or a real attack path. See `docs/content/docs/9.adding-tooling.md`.
- A change to the standard updates the handbook, the checklist, the starters and
  the audit together, and adds an entry to `internals/decisions.md`.
- Never add `NPM_TOKEN`, a Vercel token or any other long-lived credential to a
  workflow or starter.
- Pin GitHub Actions by full commit SHA; give each job only the permissions it needs.

## Principles

- The handbook stays at about nine pages. Procedures live there, not in each
  library repository. When a page or heading moves, add the old path to
  `redirectFrom` (see `docs/WRITING.md`).
- Starters produce repositories that work without this repository.
- The skill is a thin pointer to the handbook and the audit; do not copy policy into it.
  `skill/lupinum-oss/` is its only copy; personal skill collections link to it.
- Repository settings follow the handbook's "Set up a repository" page, minus
  the npm parts: ruleset with the required `ci` check, secret scanning with
  push protection, CodeQL default setup (no CodeQL workflow file).
- Vercel deploys `docs/` through its Git integration (Root Directory `docs`,
  files outside the root included); `docs/vercel.json` holds the build and ignore commands.
