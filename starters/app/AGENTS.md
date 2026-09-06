# Working on {{TITLE}}

{{DESCRIPTION}}

## Architecture

- `app/` owns the Nuxt application and user interface.
- `public/` owns static public assets.
- `test/` verifies application invariants.
- This repository deploys an application. It does not publish an npm package.

## Working procedure

Read [MAINTAINING.md](MAINTAINING.md) for setup, commands, authority, and recovery.
Inspect existing work and define observable acceptance criteria. Make the smallest
complete change. Run focused checks, explore user-facing changes in a real browser,
and run `pnpm verify` before handoff. Obtain review, complete the authorized merge,
verify the result, and clean up only your own processes and disposable files.

Keep versions, exports, and command definitions in package manifests. Update
instructions with behavior; remove the obsolete instructions in the same change.

## Invariants

- Keep server-only values out of public runtime configuration.
- Do not add npm publication workflows or `NPM_TOKEN`.
- Do not bypass the 24-hour dependency quarantine. An urgent exception must name one exact version, reason, and removal time.
- Do not use special `codex/*` or `claude/*` branches.
- Keep public text in Lupinum Controlled English, based on ASD-STE100.
- Verify production behavior in a real browser after deployment.
