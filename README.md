<p align="center">
  <img src="docs/public/logo.svg" width="128" alt="Lupinum OSS">
</p>

<h1 align="center">Lupinum OSS</h1>

<p align="center">
  The standard behind Lupinum open-source libraries: lazy maintenance, real security, no ceremony.
</p>

<p align="center">
  <a href="https://github.com/lupinum-dev/lupinum-oss/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/lupinum-oss/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-315d3b" alt="MIT license"></a>
</p>

## What is in here

- **Handbook** at [oss.lupinum.com](https://oss.lupinum.com) (source in `docs/`): overview, setting up a
  repository, releasing, dependencies, security, adding tooling, troubleshooting.
- **Starters** in `starters/`: generate a library repository that already follows the standard.
- **Audit** in `scripts/audit.mjs`: checks a repository's files and GitHub settings against the standard
  and flags excess tooling. It only reads.
- **Agent skill** in `skill/lupinum-oss/`: points coding agents at the handbook and the audit.
- **Fleet** in `fleet/libraries.json`: the repositories this standard governs.

## Use it

Requirements: Node.js 24, pnpm 11, and the GitHub CLI (`gh`) logged in for the audit.

```bash
git clone https://github.com/lupinum-dev/lupinum-oss.git
cd lupinum-oss
corepack enable
pnpm install
pnpm audit:repos lupinum-dev/nuxt-tour   # audit one repository
pnpm audit:repos                        # audit every repository in fleet/libraries.json
```

To start a new library, follow [Set up a repository](https://oss.lupinum.com/docs/set-up-a-repository).

## Contributing

`pnpm verify` runs what CI runs. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) and [SECURITY.md](.github/SECURITY.md).
Questions: [Discord](https://discord.lupinum.com).

## License

[MIT](./LICENSE) © Lupinum OG and contributors.
