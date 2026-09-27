# {{TITLE}}

{{DESCRIPTION}} Published to npm as `{{PACKAGE_NAME}}`.

## Commands

```bash
pnpm install
pnpm dev          # rebuild the package on change
pnpm docs:dev     # run the documentation site
pnpm test
pnpm format       # apply lint fixes
pnpm verify       # exactly what CI runs: lint, typecheck, test, build, audit
pnpm changeset    # describe a user-facing change for the next release
```

`pnpm build` builds the package, the docs site and `dist/agent/`, a copy of the
rendered docs that ships as `{{PACKAGE_NAME}}/agent-docs` so agents in consuming
projects read documentation that matches the installed version.

## Hard rules

- Never publish to npm, push to `main`, create tags or release by hand. Releases
  happen when a maintainer merges the "Version packages" PR and approves the
  protected `npm` environment.
- Never add `NPM_TOKEN` or any other long-lived publish credential.
- Add a changeset (`pnpm changeset`) to every pull request that changes what
  users see. CI requires one when `src/` changes; use `pnpm changeset --empty`
  if users see nothing.
- Changeset style: one line in present tense that starts with Fix, Add, Remove
  or Change and says what changed for users. A major change adds a second line
  that starts with `Migration:` and says what users must do.
- Do not bypass the 24-hour dependency quarantine (`minimumReleaseAge`). Do not
  add dependencies to `allowBuilds` without a reason.
- Pin GitHub Actions to full commit SHAs. Give each job only the permissions it needs.
- Keep tooling lean. Add a script, check or workflow only when it guards
  behaviour users rely on or closes a real attack path. Process is not security.
- Record lasting choices in [DECISIONS.md](DECISIONS.md).

## Principles

- Keep the public API in `src/index.ts` small. Everything exported is a promise
  to users.
- Update `docs/` in the same pull request as the behaviour it describes.
- Test public behaviour, not internals.
