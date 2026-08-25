# Maintaining {{TITLE}}

## Quick fix

Create a focused branch. Add a regression test in the package that owns the behavior. Run `pnpm verify` and open a focused pull request.

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
