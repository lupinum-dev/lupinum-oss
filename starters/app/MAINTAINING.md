# Maintaining {{TITLE}}

## Setup and daily work

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev
```

Use the local URL printed by the development server. Keep that session running
while you work. Stop only processes you started. Keep temporary changes and
controlled failures in an isolated checkout.

An assigned task delegates setup, diagnosis, implementation, verification,
review, routine pull requests and protected merges. Routine work has no breaking
contract, data migration, or permission change, and has passing checks and a
known rollback. Meaningful code, CI, and dependency changes need independent
review of the final diff. Ask for unresolved product decisions or expanded
security authority. Prepare the evidence before asking.

## Commands and evidence

| Command | Evidence |
|---|---|
| `pnpm dev` | A usable local development target. Inspect its real browser behavior. |
| `pnpm build` | The primary production output. |
| `pnpm verify` | The complete local handoff gate defined in package scripts. |
| `pnpm audit:all` | Dependency audit for the full workspace. |

Explore the landing page, support navigation, keyboard focus, and narrow-screen
layout. Local checks do not prove hosted analytics or production configuration.
Production deployment needs explicit task authorization or a named environment
policy. Because Vercel deploys `main`, obtain that authority before merging a
change that would deploy. Do not add npm release commands to this application.

## Large change

Open an issue first. Record important architecture decisions. Keep migration and rollback steps explicit.

## Dependency update

Use Renovate for routine updates. Do not bypass the 24-hour quarantine. Run `pnpm verify`, which includes the audit.

## Documentation or copy change

Follow [docs/WRITING.md](docs/WRITING.md). Run `pnpm build`. Inspect desktop and mobile previews.

## Deployment

Merge only after required CI and Vercel checks pass. Vercel deploys current `main` from the repository root. Verify the primary journey, navigation, metadata, Plausible, external links, console, failed requests, robots file, and sitemap on the canonical domain.

## Rollback

Use Vercel to promote the last known-good deployment. Then revert or fix the responsible commit through a pull request. Do not leave production and `main` different without an incident note.

## Credential incident

Stop deployments. Revoke the affected credential, review logs, and rotate it in the owning service. Never commit replacement secrets. Confirm that old deployments cannot read the new value.
