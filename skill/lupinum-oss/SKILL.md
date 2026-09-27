---
name: lupinum-oss
description: Work on Lupinum open-source library repositories using the Lupinum OSS handbook and its read-only audit. Use when creating a new Lupinum library, auditing a repository or the whole fleet against the standard, preparing or unblocking a release (Changesets, npm trusted publishing), handling dependency or security problems, or deciding whether a script or check should be added.
---

# Lupinum OSS

The policy lives in the handbook, not here. This skill tells you where to look
and what you may do.

## Sources

- Handbook: https://oss.lupinum.com (source: `docs/content/docs/` in the
  `lupinum-dev/lupinum-oss` checkout; when this skill sits inside that
  checkout, the root is two directories up). Seven pages: overview,
  set-up-a-repository, releasing, dependencies, security, adding-tooling,
  troubleshooting. Read only the page the task needs.
- Audit: `scripts/audit.mjs` in the same checkout.
- The target repository's own `AGENTS.md` and `DECISIONS.md`. They win over
  the handbook for that repository; report conflicts instead of picking a
  third option.

If there is no checkout, clone `https://github.com/lupinum-dev/lupinum-oss`
into a temporary directory and run `pnpm install` there.

## Hard limits

- Never publish to npm, never approve the `npm` environment, never push to
  `main`. Open pull requests.
- Never create or store an npm token. Never copy a GitHub token into a file,
  environment variable or secret.
- Do not change repository settings, rulesets, environments or npm settings
  unless the user asked for that exact change. The audit only reads.
- Do not weaken a required check to make something pass.

## Tasks

**Audit.** Run `pnpm audit:repos OWNER/REPO` (all governed repositories when
no argument; `node scripts/audit.mjs --local DIR` for files only). Report each
`FAIL` with the smallest fix, then the `WARN`s. A `WARN` that says
"unverified" means your access could not read the setting; say so rather than
guessing.

**Create a repository.** Follow the handbook's "Set up a repository" page.
Generate from `starters/`, run `pnpm verify`, open a pull request. Run the
`gh api` settings commands only if the user authorized them. List the steps
that need the maintainer (npm trusted publisher and publishing access, Vercel
project, GitHub App installs, first publication) with links to the handbook.

**Change a library.** Follow its `AGENTS.md`. Add a changeset for every
user-facing change, written as the "Releasing" page says; a change to
`dependencies` or `peerDependencies` of a published package needs one that
bumps that package. Run `pnpm verify` before you hand off. When the maintainer
asks you to complete someone else's pull request that lacks a changeset,
push one to its branch.

**Release.** Releases are the maintainer's two clicks. You may prepare
changesets, review the Version packages pull request (`release.yml` rejects
anything but `package.json` versions, the version ranges of the repository's
own packages in `package.json`, `CHANGELOG.md` files and changeset files), and diagnose
failures with "Releasing → When publishing fails" and "Troubleshooting". A
manual run of `release.yml` only re-offers a release already versioned on
`main`. Hand the approval, and any `npm dist-tag` change, back to the
maintainer.

**Dependencies and security.** Use the "Dependencies" and "Security" pages.
Never bypass the quarantine silently; an exclusion is one exact version, with
a comment and a removal date, in a pull request.

**Adding tooling.** Before adding a script, check, workflow or document,
apply the rule on the "Adding tooling" page. When in doubt, do not add it and
say why.

## Report

State what you changed, what you ran and its result, what is still `FAIL` or
unverified, and which steps are left for the maintainer.
