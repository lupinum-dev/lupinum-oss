# Working on {{TITLE}}

## Architecture

- `packages/{{PACKAGE_1_DIR}}` owns framework-neutral logic.
- `packages/{{PACKAGE_2_DIR}}` owns the main integration and may depend on the core package.
- `docs/` consumes workspace packages through public entry points.
- `scripts/` certifies the complete fixed-version package set.

## Commands

Run `pnpm verify` before handoff. Run `pnpm release:verify` before a release. Use `pnpm docs:build` for documentation and `pnpm audit:all` for the complete workspace audit.

## Invariants

- Keep both public packages on one fixed version.
- Do not bypass package boundaries with private source imports.
- Do not publish from a workstation after the first npm bootstrap.
- Do not add `NPM_TOKEN` or rename `publish.yml` without migrating all trusted publishers.
- Do not bypass the 24-hour dependency quarantine. An urgent exception must name one exact version, reason, and removal time.
- Do not use special `codex/*` or `claude/*` branches.
- Keep public text in Lupinum Controlled English, based on ASD-STE100.
