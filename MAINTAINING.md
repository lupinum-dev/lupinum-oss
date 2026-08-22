# Maintaining Lupinum OSS

## Daily changes

Create a focused branch, make the smallest complete change, run `pnpm verify`, and open a pull request. Review the documentation preview when public content changes.

## Standard changes

Open an issue first. State the proven problem, the repositories affected, the proposed rule, and the migration cost. Update the handbook before or with starter behavior. Do not silently rewrite existing repositories.

The canonical on-demand Vercel workflow is
`starters/_shared/vercel-preview.yml`. Run `pnpm shared:sync` after changing it,
review every generated copy, and run `pnpm verify`. Existing repositories apply
the reviewed copy through normal pull requests.

Run `pnpm fleet:audit` before and after a fleet rollout. It reads GitHub state
without changing it. Complete the Vercel portion through the authenticated
Lupinum OSS agent procedure; do not store a team-wide Vercel token in this
repository or its CI.

Run `pnpm fleet:release-audit` for release conformance. It derives package and
workflow inventories from each repository, reads GitHub and npm without
mutation, and separates failed, unverified, and human-only evidence.

## Dependency updates

Prefer Renovate. Wait until a new external version is at least 24 hours old. Run `pnpm audit:all` and `pnpm verify` before merge.

Use one exact temporary exclusion only for a reviewed Lupinum release or an urgent incident. Record the reason and removal time. Remove it after 24 hours.

## Documentation deployment

Vercel uses `docs/` as the Root Directory. Enable source files outside the Root Directory because the site uses the parent pnpm workspace. `docs/vercel.json` calls the canonical root documentation build. The canonical domain is `oss.lupinum.com`. Run `pnpm docs:build` before handoff and verify the production acceptance checklist after significant changes.

Keep the Vercel ignore command aligned with the site's real dependency boundary. It must compare the previous successful deployment with `HEAD`, skip unrelated changes, and build when the previous SHA is missing. Check Vercel usage each quarter. Prefer preventing an unnecessary deployment over making it slightly faster.

This repository uses the same `/vercel` workflow as generated libraries. Its
Vercel project must stay connected to `lupinum-dev/lupinum-oss`, deploy `main`
automatically, and leave pull-request previews on demand.

## Handbook releases

This repository does not publish to npm. Create a GitHub release only for a meaningful handbook, starter, or skill milestone. Generate release notes with the pinned Changelogen version and use the protected GitHub workflow when it exists.

## Rollback

Revert the harmful change through a pull request. For a broken documentation deployment, promote the last known-good Vercel deployment while the fix is reviewed. Do not rewrite shared history.

## Credential incident

Disable affected workflows and integrations. Revoke exposed credentials or trusted publishers. Review GitHub and npm audit logs. Restore publication only after the exact repository, workflow, environment, and access list are verified.

## External settings

Repository files cannot prove every external control. Track Vercel ownership and domain, DNS, Plausible site and event, GitHub Apps, organization Actions permissions, and repository rulesets in the repository launch issue.
