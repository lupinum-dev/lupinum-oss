# Maintaining Lupinum OSS

## Daily changes

Create a focused branch, make the smallest complete change, run `pnpm verify`, and open a pull request. Review the documentation preview when public content changes.

## Standard changes

Open an issue first. State the proven problem, the repositories affected, the proposed rule, and the migration cost. Update the handbook before or with starter behavior. Do not silently rewrite existing repositories.

## Dependency updates

Prefer Renovate. Wait until a new external version is at least 24 hours old. Run `pnpm audit:all` and `pnpm verify` before merge.

Use one exact temporary exclusion only for a reviewed Lupinum release or an urgent incident. Record the reason and removal time. Remove it after 24 hours.

## Documentation deployment

Vercel uses `docs/` as the Root Directory. The canonical domain is `oss.lupinum.com`. Run `pnpm docs:build` before handoff and verify the production acceptance checklist after significant changes.

## Handbook releases

This repository does not publish to npm. Create a GitHub release only for a meaningful handbook, starter, or skill milestone. Generate release notes with the pinned Changelogen version and use the protected GitHub workflow when it exists.

## Rollback

Revert the harmful change through a pull request. For a broken documentation deployment, promote the last known-good Vercel deployment while the fix is reviewed. Do not rewrite shared history.

## Credential incident

Disable affected workflows and integrations. Revoke exposed credentials or trusted publishers. Review GitHub and npm audit logs. Restore publication only after the exact repository, workflow, environment, and access list are verified.

## External settings

Repository files cannot prove every external control. Track Vercel ownership and domain, DNS, Plausible site and event, GitHub Apps, organization Actions permissions, and repository rulesets in the repository launch issue.
