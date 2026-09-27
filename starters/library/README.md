<p align="center"><img src="docs/public/icon.svg" width="128" alt="{{TITLE}} icon"></p>
<h1 align="center">{{TITLE}}</h1>
<p align="center">{{DESCRIPTION}}</p>

<p align="center">
  <a href="https://www.npmjs.com/package/{{PACKAGE_NAME}}"><img alt="npm" src="https://img.shields.io/npm/v/{{PACKAGE_NAME}}"></a>
  <a href="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

## Why use {{TITLE}}?

{{DESCRIPTION}} The package has a small public API and ships TypeScript declarations.

## Requirements

- Node.js 22.14 or later, Node.js 24, or Node.js 26.

## Installation

```bash
pnpm add {{PACKAGE_NAME}}
```

## Quick start

```ts
import { greet } from '{{PACKAGE_NAME}}'

console.log(greet('World'))
```

{{CONSUMER_ONBOARDING_MARKDOWN}}

## Documentation

Read the full documentation at [{{DOMAIN}}](https://{{DOMAIN}}).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Run `pnpm verify` before you open a pull request.

## Support and security

Ask questions in the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Lupinum OG.
