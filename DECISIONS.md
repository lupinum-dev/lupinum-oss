# Decisions

Newest first. Format: `Dn (date): decision — why`.

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
- **D3 (2026-09-27): Keep `starter-smoke.yml` as a separate, non-required workflow.** — It installs and
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
