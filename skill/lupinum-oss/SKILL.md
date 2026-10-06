---
name: lupinum-oss
description: 'Build, adopt, release, document and check Lupinum open-source libraries with the Lupinum OSS handbook, starters and audit. Use when starting or building a new library, npm package, Nuxt module or Vue component library; when bringing an existing lupinum-dev repository onto the standard; for Changesets releases, npm trusted publishing and failed publishes; for library docs and docs for coding agents; for dependency, quarantine, security and CI problems; and to answer "does this library follow the standard?". Client websites belong to lupinum-website; apps with sign-in to lupinum-app.'
metadata:
  targets: both
---

# Lupinum OSS

The handbook, the checklist, the starters and the audit own the policy. This
skill only routes to them. Do not keep rules here.

## Find the source

Use a `lupinum-dev/lupinum-oss` checkout (when this skill sits inside one, the
root is two directories up; Matthias keeps it at `~/Git/0_libs/lupinum-oss`).
Check `git remote -v`. A local branch can be behind, so read the current
standard from `origin/main`: run `git fetch origin main --quiet`, then
`git show origin/main:docs/content/docs/<page>.md`. Without a checkout, clone it into a temporary directory.
Reading needs nothing; the audit needs `gh` and one `pnpm install` in the
checkout.

Read the page that owns the task, in `docs/content/docs/`:

| Task | Page |
| --- | --- |
| "Does this library follow the standard?", what is still open | `2.checklist.md`, then run the audit |
| Start a new library | `3.set-up-a-repository.md` → "Generate the repository", and `starters/` |
| Bring an existing repository onto the standard | `4.migrate-a-repository.md` |
| Changesets, the Version packages PR, a failed publish | `5.releasing.md` |
| Library docs, docs for coding agents | `6.writing-docs.md` |
| Dependency updates, the quarantine, `pnpm audit` | `7.dependencies.md` |
| Vulnerability reports, exposed credentials | `8.security.md` |
| Adding or removing a script, check or workflow | `9.adding-tooling.md` |
| Weekly maintenance, issue and pull request triage | `10.maintain-the-fleet.md` |
| Anything that fails | `11.troubleshooting.md` |

In the target repository, read `AGENTS.md` and `internals/decisions.md`. A recorded
decision there wins for that repository; report a conflict with the handbook
instead of inventing a third rule.

## Do the task

- **Start a library.** Choose the starter (`nuxt-module` for a Nuxt module,
  `library-monorepo` when a Vue package and its Nuxt module ship together,
  `library` for a framework-free package), generate it, fill in `AGENTS.md`,
  `internals/decisions.md` and the docs pages, and run `pnpm verify`. Finish with the
  checklist report below.
- **Migrate.** Follow `4.migrate-a-repository.md` in its order, including its
  edge cases, the ruleset change right before the merge, and the maintainer's
  npm step.
- **Maintain.** Follow `10.maintain-the-fleet.md` for the weekly routine and
  issue triage.
- **Change a library.** Follow its `AGENTS.md`. Add a changeset for every
  user-facing change. Run `pnpm verify` before you hand off.
- **Check.** Run `pnpm audit:repos OWNER/REPO` (or
  `node scripts/audit.mjs --local DIR` before the first push). The answer
  depends only on the must items; advice is a warning.

## Limits

- Never publish to npm, approve the `npm` environment, push to `main`, or
  create an npm token. Never copy a GitHub token into a file, variable or secret.
- Change GitHub, npm or Vercel settings only when the user asked for that
  change, then read the setting back.
- Never weaken a check, the quarantine or a ruleset to make something pass.

## Report

Lead with whether the library follows the standard. List the open must items
by item ID, one line each, grouped as "I can do now" and "needs the
maintainer". Put advice in one line at the end. Then say what you changed, what you ran with its result, and what
you could not verify.
