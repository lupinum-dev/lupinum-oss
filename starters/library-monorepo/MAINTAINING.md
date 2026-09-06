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
| `pnpm docs:build` | The public documentation site builds. |
| `pnpm release:verify` | Certified tarballs install and work in isolated consumers. |

For documentation changes, explore navigation, search, and one documented example
on desktop and a narrow screen. A successful docs build alone does not prove the
packed package works. Release verification installs the tarball independently.
Linux CI repeats certification in its own environment; npm provenance and public
release records are checked by the protected release workflow.

Routine version pull requests may be independently reviewed and merged by agents.
Keep the final protected npm approval with the maintainer. Retry the retained
tarball; do not rebuild it after approval. Documentation deploys automatically
from protected `main`; pull-request previews are on demand.

## Large change

Open an issue first. Preserve package boundaries and one fixed package-set version. Record important architecture decisions.

## Dependency update

Use Renovate for routine updates. Do not bypass the 24-hour quarantine. Run `pnpm audit:all` and `pnpm verify`.

## Documentation change

Follow [docs/WRITING.md](docs/WRITING.md). Run `pnpm docs:build` and inspect the deployed preview.

Vercel uses `docs/` as the Root Directory. Enable source files outside the Root
Directory because `docs/` needs local workspace packages. Keep `vercel.json`
in `docs/`.

## First npm release

Download every exact tarball from the successful main CI release-candidate artifact and verify it. Publish the tarballs once, in dependency order, with 2FA, the correct dist-tag, public access, and scripts disabled. Bind every package to `publish.yml` and environment `npm`. Then dispatch `publish.yml` for the same version. It derives bootstrap state only when registry bytes match and each version is still that package's sole version. It records the bootstrap packages in the GitHub release. Never rebuild the artifacts or provide a package list or bootstrap switch.

## Normal release

Run `pnpm release:prepare -- --version <version>` to update all package versions and `CHANGELOG.md` in one pull request. Merge only after `pnpm release:verify` and CI pass. Dispatch `publish.yml` from current `main` with the reviewed fixed version. The workflow derives every other value from the retained package set, requests npm approval only for absent packages, and reconciles one GitHub release.

## Rollback

Do not delete published versions. Deprecate a broken version. Restore the last good behavior and publish a fixed-version patch set.

## Credential incident

Stop releases. Revoke affected trusted publishers or credentials. Review audit logs and public package bytes. Never commit replacement secrets.
