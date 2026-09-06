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

Open an issue first. Record important architecture decisions. Keep migrations explicit and remove temporary compatibility code after the cutover.

## Dependency update

`pnpm check:dependencies` checks the install policy and exception expiry.
For an exception, put `reason`, `owner`, and UTC `expires` in an inline JSON
comment on its exact `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml`.
Use a removal time within 24 hours. Remove the entry and comment when it expires.
CI checks expiry daily, including while the repository is idle. Check generated
install configuration before installing it with
`node scripts/check-dependency-policy.mjs path/to/pnpm-workspace.yaml`.

Use Renovate for routine updates. Review release notes and lockfile changes. Do not bypass the 24-hour quarantine. Run `pnpm audit:all` and `pnpm verify`.

## Documentation change

Follow [docs/WRITING.md](docs/WRITING.md). Run `pnpm docs:build`. Verify links, mobile navigation, search, analytics, and feedback on the deployed preview.

Vercel uses `docs/` as the Root Directory. Enable source files outside the Root
Directory because the documentation build needs this workspace package. Keep
`vercel.json` in `docs/`.

## First npm release

The package must exist before npm can bind a trusted publisher. Download the exact tarball from the successful main CI release-candidate artifact and verify its SHA-256. Publish that same file once with 2FA, `--access public`, the correct dist-tag, and `--ignore-scripts`. Then bind `publish.yml` and environment `npm` as the trusted publisher. Dispatch `publish.yml` for the same version. It derives bootstrap state only when the registry bytes match and this is the sole published version. It records the exception in the GitHub release. Never rebuild the artifact or provide a bootstrap switch.

## Normal release

Update `CHANGELOG.md` with `pnpm release:prepare` in a focused pull request. Merge after `pnpm release:verify` and CI pass. Dispatch `publish.yml` from current `main` with the reviewed package version. The workflow derives every other value from exact successful `main` CI. It requests npm approval only when publication is required and repairs the tag or GitHub release separately.

## Rollback

Do not delete a published version. Deprecate a broken version, restore the last good code in a new pull request, and publish a patch. Move the dist-tag only when users need an immediate safe version.

## Credential incident

Stop releases. Revoke the affected credential or trusted publisher. Review audit logs and published bytes. Do not commit replacement secrets. Restore trusted publishing only after the repository and account are safe.
