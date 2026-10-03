# {{TITLE}}

{{DESCRIPTION}} A Nuxt module, published to npm as `{{PACKAGE_NAME}}`.

## Commands

```bash
pnpm install
pnpm dev          # run the module in playground/
pnpm docs:dev     # run the documentation site
pnpm test         # builds test/fixtures/basic with the module and checks it
pnpm format       # apply lint fixes
pnpm verify       # exactly what CI runs: lint, typecheck, test, build, audit
pnpm changeset    # describe a user-facing change for the next release
```

`pnpm build` builds the package, the docs site and `dist/agent/`, a copy of the
rendered docs that ships as `{{PACKAGE_NAME}}/agent-docs` so agents in consuming
projects read documentation that matches the installed version.
The "Agent setup" section of each published README tells those agents how
to add a pointer to it. Keep the `./agent-docs` export and that section.

## Hard rules

- Never publish to npm, push to `main`, create tags or release by hand. Releases
  happen when a maintainer merges the "Version packages" PR and approves the
  protected `npm` environment.
- Never add `NPM_TOKEN` or any other long-lived publish credential.
- Add a changeset (`pnpm changeset`) to every pull request that changes what
  package users install: code, types, runtime behaviour or dependencies.
  Documentation, tests and CI changes need none. CI requires one when `src/`
  changes; use `pnpm changeset --empty` if users see nothing. A change to `dependencies` or `peerDependencies` of a
  published package needs a changeset that bumps that package (at least patch).
- Changeset style: one summary line in present tense that starts with Fix, Add,
  Remove or Change and says what changed for users. A short body may follow
  after a blank line. A major change adds a line that starts with `Migration:`
  and says what users must do.
- Do not bypass the 24-hour dependency quarantine (`minimumReleaseAge`). Do not
  add dependencies to `allowBuilds` without a reason.
- Pin GitHub Actions to full commit SHAs. Give each job only the permissions it needs.
- Keep tooling lean. Add a script, check or workflow only when it guards
  behaviour users rely on or closes a real attack path. Process is not security.
- Record lasting choices in [DECISIONS.md](DECISIONS.md).

## Principles

- Keep the public API small: module options in `src/module.ts`, composables and
  components in `src/runtime/`. Everything users can import or configure is a
  promise to them.
- Every option, composable and component prop has a doc comment with its
  meaning and default. Errors say how to fix them.
- Update `docs/` in the same pull request as the behaviour it describes.
- Test public behaviour, not internals.
