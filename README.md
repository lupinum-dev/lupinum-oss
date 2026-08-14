<p align="center">
  <img src="docs/public/logo.svg" width="128" alt="Lupinum OSS">
</p>

<h1 align="center">Lupinum OSS</h1>

<p align="center">
  Start, document, maintain, and release open-source software through one tested Lupinum path.
</p>

<p align="center">
  <a href="https://github.com/lupinum-dev/lupinum-oss/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/lupinum-oss/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-315d3b" alt="MIT license"></a>
</p>

> [!IMPORTANT]
> Lupinum OSS is being built in public. The handbook records proven practice from real Lupinum repositories. Starter changes must pass their own conformance tests before we recommend them.

## Why use Lupinum OSS?

New repositories should not rediscover how to write a README, protect `main`, deploy documentation, preview a package, or publish safely to npm.

This repository provides one public handbook, three tested starters, and a thin Codex skill. Each generated repository remains understandable and maintainable without this repository or Codex.

## When to use it

Use Lupinum OSS when you create or audit a Lupinum library, multi-package library, or deployed Nuxt application.

Do not use it to force unrelated source code into one architecture. The standard controls public, operational, documentation, security, and release surfaces. Product architecture stays local to each repository.

## Requirements

- Node.js 24
- pnpm 11
- Git and GitHub CLI for repository setup
- npm 2FA for the first publication of a new package
- A Vercel account for public documentation deployment

## Installation

Clone this repository to read the handbook and run the starters locally:

```bash
git clone https://github.com/lupinum-dev/lupinum-oss.git
cd lupinum-oss
corepack enable
pnpm install --frozen-lockfile
```

The Codex skill lives in [`skill/lupinum-oss`](./skill/lupinum-oss). Install it through the supported Codex skill workflow after the first public release of this kit.

## Quick start

Choose a profile:

```bash
# One published package and a documentation site
node starters/library/setup.mjs --help

# Several fixed-version packages and a documentation site
node starters/library-monorepo/setup.mjs --help

# A deployed Nuxt application without npm publication
node starters/app/setup.mjs --help
```

Run the generated repository's `pnpm verify` command before its first commit.

## What is included

- `docs/`: public standards, procedures, checklists, and troubleshooting.
- `starters/library/`: single-package library starter.
- `starters/library-monorepo/`: fixed-version workspace starter.
- `starters/app/`: deployed Nuxt application starter.
- `skill/lupinum-oss/`: thin Codex operator for creation, audits, and releases.
- `scripts/`: conformance checks for this repository and its starters.

## Documentation

Read the handbook at [oss.lupinum.com](https://oss.lupinum.com). Start with the [repository launch checklist](https://oss.lupinum.com/docs/checklists/repository-launch).

Vercel deploys this workspace from the repository root. The root
[`vercel.json`](./vercel.json) builds the documentation app in `docs/`.

## Contributing and development

```bash
pnpm verify
pnpm docs:dev
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a pull request. Maintainers use [MAINTAINING.md](./MAINTAINING.md).

## Support and security

- Open a [documentation report](https://github.com/lupinum-dev/lupinum-oss/issues/new?template=documentation.yml) for an unclear instruction.
- Open a [focused proposal](https://github.com/lupinum-dev/lupinum-oss/issues/new?template=proposal.yml) before changing the standard.
- Join the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N).
- Follow [SECURITY.md](./SECURITY.md) for private vulnerability reports.

## License

[MIT](./LICENSE) © Lupinum OG and contributors.
