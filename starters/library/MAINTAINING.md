# Maintaining {{TITLE}}

## Quick fix

Create a focused branch. Add a regression test. Run `pnpm verify`. Open a pull request with the result, verification, release note, and risk.

## Large change

Open an issue first. Record important architecture decisions. Keep migrations explicit and remove temporary compatibility code after the cutover.

## Dependency update

Use Renovate for routine updates. Review release notes and lockfile changes. Do not bypass the 24-hour quarantine. Run `pnpm audit:all` and `pnpm verify`.

## Documentation change

Follow [docs/WRITING.md](docs/WRITING.md). Run `pnpm docs:build`. Verify links, mobile navigation, search, analytics, and feedback on the deployed preview.

Vercel uses the repository root because the documentation build needs this
workspace package. Keep `vercel.json` at the repository root.

## First npm release

The package must exist before npm can bind a trusted publisher. Download the exact tarball from the successful main CI release-candidate artifact and verify its SHA-256. Publish that same file once with 2FA, `--access public`, `--tag latest`, and `--ignore-scripts`. Then bind `publish.yml` and environment `npm` as the trusted publisher. Dispatch `publish.yml` for the same version. It verifies and skips the existing bytes, checks the dist-tag, and creates the GitHub release. Never rebuild the bootstrap artifact or create the tag manually.

## Normal release

Update `CHANGELOG.md` with `pnpm release:prepare` in a focused pull request. Merge after `pnpm release:verify` and CI pass. Dispatch `publish.yml` from current `main` with the exact package version. Approve the protected `npm` environment. The workflow publishes the certified tarball and creates the GitHub release.

## Rollback

Do not delete a published version. Deprecate a broken version, restore the last good code in a new pull request, and publish a patch. Move the dist-tag only when users need an immediate safe version.

## Credential incident

Stop releases. Revoke the affected credential or trusted publisher. Review audit logs and published bytes. Do not commit replacement secrets. Restore trusted publishing only after the repository and account are safe.
