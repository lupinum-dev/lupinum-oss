# {{TITLE}}

{{DESCRIPTION}} A set of npm packages in `packages/` that always release together
with one version (a Changesets `fixed` group). `{{PRIMARY_PACKAGE}}` is the main entry point.

## Commands

```bash
pnpm install
pnpm dev          # rebuild all packages on change
pnpm docs:dev     # run the documentation site
pnpm test
pnpm format       # apply lint fixes
pnpm verify       # exactly what CI runs: lint, typecheck, test, build, audit
pnpm changeset    # describe a user-facing change for the next release
```

`pnpm build` builds every package, the docs site and each package's `dist/agent/`,
a copy of the rendered docs that ships as `<package>/agent-docs` so agents in
consuming projects read documentation that matches the installed version.
The "Agent setup" section of each published README tells those agents how
to add a pointer to it. Keep the `./agent-docs` export and that section.

## Hard rules

- Never publish to npm, push to `main`, create tags or release by hand. Releases
  happen when a maintainer merges the "Version packages" PR and approves the
  protected `npm` environment.
- Never add `NPM_TOKEN` or any other long-lived publish credential.
- Add a changeset (`pnpm changeset`) to every pull request that changes what
  package users install: code, types, runtime behaviour or dependencies.
  Documentation, tests and CI changes need none. CI requires one when
  `packages/*/src/` changes; use `pnpm changeset --empty` if users see nothing. A change to `dependencies` or
  `peerDependencies` of a published package needs a changeset that bumps that
  package (at least patch).
- Changeset style: one summary line in present tense that starts with Fix, Add,
  Remove or Change and says what changed for users. A short body may follow
  after a blank line. A major change adds a line that starts with `Migration:`
  and says what users must do.
- A new package joins the `fixed` group in `.changeset/config.json`. Its first
  npm version is published by the maintainer (see the Lupinum OSS handbook).
- Do not bypass the 24-hour dependency quarantine (`minimumReleaseAge`). Do not
  add dependencies to `allowBuilds` without a reason.
- Pin GitHub Actions to full commit SHAs. Give each job only the permissions it needs.
- Keep tooling lean. Add a script, check or workflow only when it guards
  behaviour users rely on or closes a real attack path. Process is not security.
- Record lasting choices in [DECISIONS.md](DECISIONS.md).

## Principles

- Keep each package's public API in its `src/index.ts` small. Everything
  exported is a promise to users.
- Every export and option has a doc comment with its meaning and default.
  Errors say how to fix them.
- Packages depend on each other with `workspace:^`, never on relative paths.
- Update `docs/` in the same pull request as the behaviour it describes.
- Test public behaviour, not internals.
