# Library fleet

`libraries.json` is the source of truth for repositories governed by the
Lupinum library documentation deployment policy. It records only fleet
membership, the Vercel project mapping, and the deployment policy.

Repository architecture, build commands, and documentation dependency
boundaries stay in each repository. Customer applications do not belong in
this inventory.

Run `pnpm fleet:audit` for a read-only GitHub audit. A complete operational
audit also reads the mapped projects through the authenticated Vercel
connection as described by the Lupinum OSS skill.
