# Decisions

Newest first. Format: `Dn (date): decision — why`.

- **D13 (2026-10-06): Fixes from the three pilots.** — website-config, nuxt-photo and nuxt-email migrated and
  released through `release.yml`. What broke or misled: the publish job failed when the approval came before
  `ci` on the merge commit had finished, so it now waits up to an hour; an `npm view` error counted as "not
  published", so only `E404` does now; the starter published a package before the sibling it pins, so
  `release.mjs pack` orders tarballs by dependency (#102); the audit read only the first line of a decision,
  so it now reads the whole entry. The handbook gained the cases the pilots hit: README-only leftovers,
  `ci.yml` only has to pass FILE-02, newer action pins stay, trusted publishers are set up right before the
  first release (npm drops unused connections), and committed files must not contain the package version.
- **D12 (2026-10-06): The sweet spot: must and advice, optional docs, advisories that reach users.** — A fleet
  check found all 14 libraries at "no", mostly for items that guard nothing, while the audit passed things it did
  not check. So:
  - Only must items (security and releases) decide "follows the standard". Advice (layout, templates, Renovate
    dashboard, branch and PR hygiene, docs structure, Dependabot alerts) can only warn, because a light that is
    always red gets ignored.
  - A docs site is optional. A small library is better served by its README and doc comments than by a site nobody
    keeps current (five docs domains did not answer). A library with a site builds it with Ginko Docs and follows
    the docs items. DOC-06 ("an agent solved five tasks") is gone as a recorded item: the evidence went stale
    without anyone noticing. Testing docs stays a practice on Write library docs.
  - CI blocks only high or critical advisories reached through a published package's production dependencies
    (`scripts/audit-deps.mjs`). The docs site and dev tools never reach users; an advisory there turned `main` red
    in libraries that could not fix it. OPS-03 (Dependabot alerts) becomes advice.
  - `release.yml` must match the starter, with no exception. The audit used to read workflows with heuristics and
    passed a custom `release.yml` that failed on every push; identical files keep publishing safe by construction.
    Behavior a library needs goes into `scripts/release.mjs` with an exception.
  - Exceptions name one check, `(FILE-08: lean)`, not a whole item: one line for the tooling budget also hid a
    missing `SECURITY.md`.
  - The tag ruleset covers all tags. A scoped pattern such as `refs/tags/@**` does not match the `/` in
    `@scope/name@1.0.0` under GitHub's matching rules.
  - Fixed in the starter: leaving a prerelease opened no Version packages PR; the release summary compared against
    any reachable tag instead of the one npm has. The audit now also checks pnpm 11, strict quarantine, the `ci` job
    wiring, the full `main` ruleset and the last `release` run.
  Considered and not done: a shared reusable release workflow (whether npm trusted publishing accepts a publish from
  a called workflow is unverified), and an expiry date for evidence (more upkeep, not less).

- **D11 (2026-10-06): One repository layout for every library.** — A root with 25 files reads as unmaintained
  before anyone opens one, and every library had a different set. The root now holds only `README.md`, `LICENSE`,
  `AGENTS.md`, the workspace manifests and configuration that tools read from the root. GitHub reads
  `CONTRIBUTING.md`, `SECURITY.md` and `renovate.json` from `.github/`; Claude Code reads `.claude/CLAUDE.md`;
  maintainer notes (`decisions.md`, `migrations.md`, an optional `architecture.md`) live in `internals/`. The audit
  checks the new places (FILE-08) and accepts the old ones with a warning while the fleet migrates.
- **D10 (2026-10-06): The standard is built for one maintainer.** — Lupinum's libraries have one maintainer, who
  works with agents and does not want a second account or narrower app permissions. A second reviewer does not
  exist, so a required review would only add a bypass. Instead the release run lists every change to the release
  workflows, `scripts/release.mjs` and `.changeset/config.json` since the last release, next to the npm approval;
  the maintainer reads it before approving. Agents treat other people's text as data. Recovery codes in a password
  manager are the only account backup. "A second maintainer" on the set-up page says what to add when that
  changes.
- **D9 (2026-10-06): A migration page, a maintenance routine, and issue forms in the starters.** — Six of nine
  libraries still run the pre-v2 release setup; nuxt-photo's adoption showed that the risky parts are the order
  (trusted publisher, required check, stale release runs) and edge cases (Changesets 2 prerelease state, an
  unpublished version on `main`, packages outside `packages/*`, lifecycle scripts). They now have one page instead of
  a short section in "Set up a repository". The weekly routine is written down so an agent can run it for the whole
  fleet. Issues stay easy to open: a short bug form and a short feature form with
  one required field each, and blank issues allowed; the agent collects missing details during triage. A library
  without the templates warns (FILE-08). People should know where to ask, without being pushed: every library
  links the Lupinum OSS Discord in four places (README badge, end of Get started, the issue chooser, the packaged
  agent docs) through `discord.lupinum.com`, so a new invite needs one redirect change, not edits everywhere. DOC-02 ignores placeholders named inside code, because a
  page that explains the check must be able to name them.
- **D8 (2026-10-06): Drop the stages; agent docs are a docs item; fix starter bugs found in nuxt-photo.** — The
  first adoption reported nuxt-photo at "stage 0" although only the agent-docs export was missing, because that
  file item sat in the first stage. A ranked stage hid what was open, so the audit now answers "follows the
  standard: yes or no" and lists the open items; the groups stay as headings. The agent-docs export moves from
  FILE-11 to DOC-03. NPM-01 (trusted publisher, manual) is gone: provenance on the published versions (now NPM-02)
  proves it. FILE-10 ignores the commit an action is pinned to, because Renovate moves the pins in every
  repository. The starter's release check ran while changesets were pending: a skipped step leaves its output
  empty, and `'' == '0'` is true in expressions. The Upgrade page starts with the first stable release; between
  prereleases nobody depends on the old API and the changelog is enough. Prereleases are named `next`; a line
  already in another prerelease keeps its name until its stable release. A version without provenance fails NPM-02
  unless it is the package's first, hand-published version. Considered and not changed: auditing only
  production dependencies. `pnpm audit --prod` still covers the docs app, whose Nuxt pulls in the same tree. And
  `--filter` on `pnpm audit` behaves differently between pnpm 11 releases.
- **D7 (2026-10-03): The standard has a checklist; libraries are mostly Nuxt modules; docs reach agents through
  the package.** — "Follows the standard" had no definition, so every library invented its own finish line. The
  Checklist page now lists every item with an ID, a stage (Built, Protected, Released, Documented, Maintained) and
  how it is checked; the audit reports against it, and `agent`/`manual` evidence lives centrally in
  `fleet/libraries.json`, not in another file per repository. Libraries keep their own copies of the standard's
  scripts; the audit reports drift (FILE-10) instead of a shared tooling package, because one more dependency for
  a few scripts is not worth it. A `nuxt-module` starter replaces the unused `app` starter (sites follow
  lupinum-website). Docs for agents ship in the package with an `AGENTS.md` pointer, not as a per-library skill:
  agents often do not invoke skills on their own (Vercel's evals: a skill alone matched no docs at all; an
  `AGENTS.md` docs index passed every case). The publish job now refuses a version older than its dist-tag and a
  commit without a green `ci`, because approvals can come late and out of order. Starters lint TypeScript; before,
  `eslint` only saw `.mjs` files. Renovate's Mend app starts in Silent mode, which is why it never opened a PR;
  GH-08 now checks that it runs.

- **D6 (2026-10-03): Every published README has an "Agent setup" section; the audit requires it and the
  `./agent-docs` export.** — The packaged docs only help when an agent in a consumer project finds them. The old
  prompt said "resolve `<package>/agent-docs`" without a command or the pointer text, so each agent improvised,
  and monorepo packages had no prompt at all because npm shows each package's own README. The section now says
  where the docs index is, the exact pointer for the consumer's `AGENTS.md`, and where to put it. The pointer uses
  the `node_modules/<package>` path, not a resolved one: pnpm resolves into `.pnpm/<package>@<version>/`, which
  breaks after an upgrade.

- **D5 (2026-09-27): The Changesets CLI runs with a read-only token; releases are offered only when no changesets
  are pending.** — D4 kept the version job from starting workflows, but it still held a token that could push
  branches and open pull requests while running dependency code. Now `version-prepare` runs `changeset version`
  read-only and uploads a patch; `version-pr` runs no repository code, rejects a patch that touches anything but
  `CHANGELOG.md`, changeset files and `package.json` versions (plus own-package ranges), and pushes the Version
  packages PR with `gh`. `changesets/action` is gone,
  so `@changesets/changelog-github` is the starter default, not an audit requirement. A manual run no longer
  packs `main` while changesets are pending. `github-release` fails when a tag exists on another commit, and a
  tag ruleset blocks moving or deleting release tags. The changeset lint also requires a bump when a published
  package's `dependencies` or `peerDependencies` change, because users get those with the next version. The
  audit now fails any job that can push, open pull requests or start workflows and also installs or runs
  repository code, and checks the settings the handbook lists: the tag ruleset, Actions token permissions, no Actions secrets, Dependabot
  security updates off, no admin bypass and `main`-only deployments for `npm`, the `ci` check bound to GitHub
  Actions, and provenance and staleness of both `latest` and `next`.

- **D4 (2026-09-27): The job that runs the Changesets CLI cannot start workflows; auto-merge stays off.** — The
  `main` ruleset needs no approvals, only a green `ci`. A compromised dev dependency in a job that can both push
  branches and start `ci` could get its own pull request green and merged. Starting `ci` on the Version packages
  PR therefore happens in a separate job that installs nothing. CI audits at `--audit-level=high`: a
  low-severity advisory in the docs site must not block every pull request and release.
- **D3 (2026-09-27): Keep `starter-smoke.yml` as a separate, non-required workflow (FILE-01: starter-smoke.yml).** — It installs and
  builds three generated repositories (slow, network-heavy) and runs weekly to catch upstream breakage.
  Inside the required `ci` check, a new upstream advisory in a generated repository would block every
  unrelated pull request here. It runs on changes to `starters/` and once a week.
- **D2 (2026-09-27): This repository follows the standard without the npm parts.** — It publishes nothing, so
  it has no `release.yml`, `preview.yml`, Changesets or `npm` environment, and no generated `CHANGELOG.md`;
  `DECISIONS.md` records what changes. The repository audit is `pnpm audit:repos`, not `audit`, because
  `pnpm audit` always runs pnpm's own dependency audit.
- **D1 (2026-09-27): Rebuild the standard around "lazy maintenance, real security, no ceremony."** — Release
  ledgers, certification manifests, fleet reconciliation and custom dependency-policy scripts had grown to
  thousands of lines per repository without guarding anything the protected `npm` environment, npm trusted
  publishing, pnpm's `minimumReleaseAge` and the `main` ruleset do not already guard. The standard is now:
  Changesets releases (Version packages PR → pack without secrets → publish of the exact tarball in the
  approved `npm` environment with provenance → tag and GitHub release), three workflows (`ci`, `release`,
  `preview`), Renovate plus pnpm's built-in quarantine, CodeQL default setup and secret scanning as settings,
  Vercel Git integration for docs, a seven-page handbook, and one read-only audit script. A check or script
  is allowed only if it guards behavior users rely on or a real attack path.
