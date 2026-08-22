# Working on Lupinum OSS

This repository is the public source for the Lupinum OSS handbook, repository starters, and Codex skill.

## Ownership

- `docs/` explains the fleet-wide standard and public procedures.
- `starters/` contains complete, tested repository starting points.
- `skill/lupinum-oss/` is a thin operator that reads the handbook and repository-local instructions.
- `scripts/` checks objective contracts. It must not judge prose quality as if it were formal ASD-STE100 certification.

Do not duplicate detailed policy in the skill or starter documentation. The handbook explains fleet policy. A generated repository remains self-contained through its own `AGENTS.md` and `MAINTAINING.md`.

## Commands

```bash
pnpm verify
pnpm docs:build
pnpm audit:all
pnpm release:verify
pnpm shared:check
pnpm fleet:check
pnpm fleet:release-check
```

Run `pnpm verify` before handoff. Run `pnpm release:verify` before a tagged release of this handbook repository.

## Invariants

- Keep this repository private to npm: it does not publish a package.
- Do not add `NPM_TOKEN`.
- Do not add a central publication service or shared runtime package.
- Keep starter publication workflows local and reviewable.
- Maintain the on-demand Vercel preview workflow once in
  `starters/_shared/vercel-preview.yml`. Run `pnpm shared:sync` after changes
  and commit the exact repository-owned copies.
- Keep `fleet/libraries.json` limited to public libraries governed by this
  standard. Do not add customer applications or duplicate repository-local
  package inventories or build configuration there.
- Pin GitHub Actions to full commit SHAs.
- Use `docs/` as the Vercel Root Directory. Keep `vercel.json` in `docs/` and
  enable source files outside the Root Directory because the site uses this
  pnpm workspace.
- Keep the npm bootstrap ceremony explicit. Do not pretend the first package version has OIDC provenance.
- Use `latest` for stable releases and `next` for prereleases.
- Do not silently bypass the 24-hour dependency quarantine.
- Do not use special `codex/*` or `claude/*` branch rules.

## GitHub CLI authentication

A failed sandboxed `gh auth status` is not proof that authentication expired. Retry `gh auth status -h github.com` and `gh api user` with elevated access before asking the user to log in again. Never copy a GitHub token into files or environment variables to bypass macOS Keychain access.
