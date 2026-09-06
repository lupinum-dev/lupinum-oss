# Working on {{TITLE}}

{{DESCRIPTION}}

## Architecture

- `packages/` contains independent public packages in one fixed-version release set.
- `packages/{{PRIMARY_PACKAGE_DIR}}` is the primary package used by documentation examples.
- `docs/` consumes workspace packages through public entry points.
- `scripts/` certifies the complete fixed-version package set.

## Working procedure

Read [MAINTAINING.md](MAINTAINING.md) for setup, commands, authority, and recovery.
Inspect existing work and define observable acceptance criteria. Make the smallest
complete change. Run focused checks, explore user-facing changes in a real browser,
and run `pnpm verify` before handoff. Obtain review, complete the authorized merge,
verify the result, and clean up only your own processes and disposable files.

Keep versions, exports, and command definitions in package manifests. Update
instructions with behavior; remove the obsolete instructions in the same change.

## Invariants

- Keep all public packages on one fixed version.
- Changesets owns package versions. Changelogen generates release notes only.
- Do not bypass package boundaries with private source imports.
- Do not publish from a workstation after the first npm bootstrap.
- Do not add `NPM_TOKEN` or rename `publish.yml` without migrating all trusted publishers.
- Do not bypass the 24-hour dependency quarantine. An urgent exception must name one exact version, reason, and removal time.
- Do not use special `codex/*` or `claude/*` branches.
- Keep public text in Lupinum Controlled English, based on ASD-STE100.
