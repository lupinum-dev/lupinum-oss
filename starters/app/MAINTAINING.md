# Maintaining {{TITLE}}

## Quick fix

Create a focused branch. Add a regression test. Run `pnpm verify`. Open a pull request with the result, verification, and risk.

## Large change

Open an issue first. Record important architecture decisions. Keep migration and rollback steps explicit.

## Dependency update

Use Renovate for routine updates. Do not bypass the 24-hour quarantine. Run `pnpm audit:all` and `pnpm verify`.

## Documentation or copy change

Follow [docs/WRITING.md](docs/WRITING.md). Run `pnpm docs:build`. Inspect desktop and mobile previews.

## Deployment

Merge only after required CI and Vercel checks pass. Vercel deploys current `main`. Verify the primary journey, navigation, metadata, Plausible, external links, console, failed requests, robots file, and sitemap on the canonical domain.

## Rollback

Use Vercel to promote the last known-good deployment. Then revert or fix the responsible commit through a pull request. Do not leave production and `main` different without an incident note.

## Credential incident

Stop deployments. Revoke the affected credential, review logs, and rotate it in the owning service. Never commit replacement secrets. Confirm that old deployments cannot read the new value.
