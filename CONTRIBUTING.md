# Contributing

## Read this first

Lupinum OSS defines the default operating standard for multiple repositories. Small errors can spread to every new project.

Open an issue before a non-trivial change. Keep each pull request focused on one outcome.

## Changes we welcome

- Corrections based on verified behavior.
- Small improvements to unclear procedures.
- Focused starter fixes with a regression check.
- Security improvements that preserve the simple maintainer workflow.

## Changes that need discussion first

- New repository profiles.
- Central reusable publication workflows.
- New configuration packages or generators.
- Changes to release security boundaries.
- Changes that create a second source of truth.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Explain what changed, why it is needed, what you verified, and what risks remain. Include a release note when users of the handbook, starters, or skill need to know about the change.

Do not publish packages, create tags, or bypass protected workflows from a contribution.
