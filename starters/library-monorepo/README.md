<p align="center"><img src="docs/public/icon.svg" width="128" alt="{{TITLE}} icon"></p>
<h1 align="center">{{TITLE}}</h1>
<p align="center">{{DESCRIPTION}}</p>

<p align="center">
  <a href="https://www.npmjs.com/package/{{PACKAGE_2}}"><img alt="npm" src="https://img.shields.io/npm/v/{{PACKAGE_2}}"></a>
  <a href="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

> [!WARNING]
> This package set is new. Review the release notes before you update it.

## Why use {{TITLE}}?

Use {{TITLE}} when you need {{DESCRIPTION}}. The packages use one fixed version so compatible releases remain easy to identify.

## When to use it

Use the core package for framework-neutral logic. Use the main integration for the complete public entry point. Do not install both unless your application imports both directly.

## Requirements

- Node.js 22.14 or later, Node.js 24, or Node.js 26.
- pnpm 11 for repository development.

## Installation

```bash
pnpm add {{PACKAGE_2}}
```

## Quick start

```ts
import { createItem } from '{{PACKAGE_2}}'

const item = createItem('one', 'First item')
```

## Packages

- `{{PACKAGE_1}}` provides framework-neutral utilities.
- `{{PACKAGE_2}}` provides the main integration.

## Documentation

Read the complete documentation at [{{DOMAIN}}](https://{{DOMAIN}}).

## Contributing and development

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request. Maintainers use [MAINTAINING.md](MAINTAINING.md).

## Support and security

Ask questions in the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N). Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/{{REPOSITORY}}/security/advisories/new).

## License

[MIT](LICENSE) © Lupinum OG.
