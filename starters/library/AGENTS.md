# Working on {{TITLE}}

{{DESCRIPTION}}

## Architecture

- `src/` owns the public library implementation.
- `test/` verifies public behavior and failure boundaries.
- `docs/` owns public documentation. Release verification separately tests packed consumers.
- `scripts/` owns inert package certification. It does not publish.

## Working procedure

Read [MAINTAINING.md](MAINTAINING.md) for setup, commands, authority, and recovery.
Inspect existing work and define observable acceptance criteria. Make the smallest
complete change. Run focused checks, explore user-facing changes in a real browser,
and run `pnpm verify` before handoff. Obtain review, complete the authorized merge,
verify the result, and clean up only your own processes and disposable files.

Keep versions, exports, and command definitions in package manifests. Update
instructions with behavior; remove the obsolete instructions in the same change.

## Invariants

- Keep one source of truth for public behavior.
- Do not publish from a workstation after the first npm bootstrap.
- Do not create tags manually during a normal release.
- Do not add `NPM_TOKEN`.
- Do not rename `.github/workflows/publish.yml` without migrating the npm trusted publisher.
- Do not bypass the 24-hour dependency quarantine. An urgent exception must name one exact version, reason, and removal time.
- Do not use special `codex/*` or `claude/*` branches.
- Keep public text in Lupinum Controlled English, based on ASD-STE100. Do not claim formal certification.
