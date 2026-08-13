# Working on {{TITLE}}

## Architecture

- `src/` owns the public library implementation.
- `test/` verifies public behavior and failure boundaries.
- `docs/` is a consumer of the packed public API.
- `scripts/` owns inert package certification. It does not publish.

## Commands

Run `pnpm verify` before handoff. Run `pnpm release:verify` before a release. Use `pnpm docs:build` for documentation and `pnpm audit:all` for the complete workspace audit.

## Invariants

- Keep one source of truth for public behavior.
- Do not publish from a workstation after the first npm bootstrap.
- Do not create tags manually during a normal release.
- Do not add `NPM_TOKEN`.
- Do not rename `.github/workflows/publish.yml` without migrating the npm trusted publisher.
- Do not bypass the 24-hour dependency quarantine. An urgent exception must name one exact version, reason, and removal time.
- Do not use special `codex/*` or `claude/*` branches.
- Keep public text in Lupinum Controlled English, based on ASD-STE100. Do not claim formal certification.
