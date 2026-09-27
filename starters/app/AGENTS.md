# {{TITLE}}

{{DESCRIPTION}} A Nuxt application deployed to [{{DOMAIN}}](https://{{DOMAIN}})
by Vercel's Git integration. It publishes no npm package.

## Commands

```bash
pnpm install
pnpm dev          # local development server
pnpm test
pnpm format       # apply lint fixes
pnpm verify       # exactly what CI runs: lint, typecheck, test, build, audit
```

## Hard rules

- Never push to `main`. Every change goes through a pull request with a green `ci` check.
- Keep secrets in Vercel environment variables. Never put server-only values in
  `runtimeConfig.public` or in the repository.
- Do not add npm publishing workflows or `NPM_TOKEN`.
- Do not bypass the 24-hour dependency quarantine (`minimumReleaseAge`). Do not
  add dependencies to `allowBuilds` without a reason.
- Pin GitHub Actions to full commit SHAs. Give each job only the permissions it needs.
- Keep tooling lean. Add a script, check or workflow only when it guards
  behaviour users rely on or closes a real attack path. Process is not security.
- Record lasting choices in [DECISIONS.md](DECISIONS.md).

## Principles

- `app/` holds the user interface, `public/` static files, `test/` tests.
- Check user-facing changes in a real browser, on the Vercel preview of the pull request.
