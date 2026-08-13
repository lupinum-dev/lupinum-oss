# Security policy

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/lupinum-dev/lupinum-oss/security/advisories/new).

Do not open a public issue for a vulnerability. Include the affected file or procedure, the expected impact, reproduction steps, and a safe contact method.

Lupinum OG will confirm receipt, assess the report, and coordinate a fix when the report is valid.

## Supported content

Security fixes apply to the current `main` branch and the current published handbook, starters, and skill. Generated repositories are independent after creation and must apply relevant fixes through normal reviewed pull requests.

## Publication boundary

This repository does not publish an npm package. Starter publication workflows use npm trusted publishing, GitHub OIDC, provenance, protected environments, and certified tarballs. They must never contain an `NPM_TOKEN`.
