# Library fleet

`libraries.json` is the source of truth for repositories governed by the
Lupinum library documentation deployment and release policies. It records only
fleet membership, the Vercel project mapping, the deployment policy, the
release profile, and the forward-enforcement cutoff for immutable release
history.

Repository architecture, build commands, and documentation dependency
boundaries stay in each repository. Customer applications do not belong in
this inventory.

Run `pnpm fleet:audit` for a read-only GitHub audit. A complete operational
audit also reads the mapped projects through the authenticated Vercel
connection as described by the Lupinum OSS skill.

Run `pnpm fleet:release-audit` for a read-only GitHub and npm release audit.
`none` identifies the handbook itself; it is not a fourth package release
profile. Package names, versions, build commands, and workflow filenames are
derived from each repository.

Versions published before `releaseHistoryCutoff` are reported individually as
`HUMAN-ONLY` historical exceptions. The auditor does not pretend those
immutable releases meet a contract that did not exist yet.
