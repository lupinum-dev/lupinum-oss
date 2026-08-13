# Working on {{TITLE}}

## Architecture

- `app/` owns the Nuxt application and user interface.
- `public/` owns static public assets.
- `test/` verifies application invariants.
- This repository deploys an application. It does not publish an npm package.

## Commands

Run `pnpm verify` before handoff. Use `pnpm docs:build` to run the production build. Use `pnpm audit:all` for the complete audit. `pnpm release:verify` is the deployment handoff gate.

## Invariants

- Keep server-only values out of public runtime configuration.
- Do not add npm publication workflows or `NPM_TOKEN`.
- Do not bypass the 24-hour dependency quarantine. An urgent exception must name one exact version, reason, and removal time.
- Do not use special `codex/*` or `claude/*` branches.
- Keep public text in Lupinum Controlled English, based on ASD-STE100.
- Verify production behavior in a real browser after deployment.
