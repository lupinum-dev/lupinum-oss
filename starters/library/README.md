<p align="center"><img src="docs/public/icon.svg" width="128" alt="{{TITLE}} icon"></p>
<h1 align="center">{{TITLE}}</h1>
<p align="center">{{DESCRIPTION}}</p>

<p align="center">
  <a href="https://www.npmjs.com/package/{{PACKAGE_NAME}}"><img alt="npm" src="https://img.shields.io/npm/v/{{PACKAGE_NAME}}"></a>
  <a href="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

> [!WARNING]
> This package is new. Review the release notes before you update it.

## Why use {{TITLE}}?

Use {{TITLE}} when you need {{DESCRIPTION}}. The package has a small public API and ships TypeScript declarations.

## When to use it

Use this package in Node.js or modern bundlers. Do not use it when the documented requirements do not match your application.

## Requirements

- Node.js 22.14 or later, Node.js 24, or Node.js 26.
- pnpm 11 for repository development.

## Installation

```bash
pnpm add {{PACKAGE_NAME}}
```

## Quick start

```ts
import { greet } from '{{PACKAGE_NAME}}'

console.log(greet('World'))
```

## Documentation

Read the complete documentation at [{{DOMAIN}}](https://{{DOMAIN}}).

Vercel deploys the documentation from the repository root because it builds
this package before it builds `docs/`.

## Contributing and development

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request. Maintainers use [MAINTAINING.md](MAINTAINING.md).

## Support and security

Ask questions in the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N). Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/{{REPOSITORY}}/security/advisories/new).

## License

[MIT](LICENSE) © Lupinum OG.
