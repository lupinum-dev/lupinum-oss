<p align="center"><img src="docs/public/icon.svg" width="128" alt="{{TITLE}} icon"></p>
<h1 align="center">{{TITLE}}</h1>
<p align="center">{{DESCRIPTION}}</p>

<p align="center">
  <a href="https://www.npmjs.com/package/{{PACKAGE_NAME}}"><img alt="npm" src="https://img.shields.io/npm/v/{{PACKAGE_NAME}}"></a>
  <a href="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/{{REPOSITORY}}/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://discord.lupinum.com"><img alt="Discord" src="https://img.shields.io/badge/Discord-join%20the%20chat-5865F2?logo=discord&logoColor=white"></a>
</p>

## Why use {{TITLE}}?

{{DESCRIPTION}} It is a Nuxt module with a small public API and TypeScript declarations.

## Requirements

- Nuxt 4.
- Node.js 22.14 or later, Node.js 24, or Node.js 26.

## Installation

```bash
pnpm add {{PACKAGE_NAME}}
```

## Quick start

Add the module to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['{{PACKAGE_NAME}}'],
})
```

Then use the auto-imported composable in any component:

```vue
<script setup lang="ts">
const greeting = useGreeting('World')
</script>
```

{{CONSUMER_ONBOARDING_MARKDOWN}}

## Documentation

Read the full documentation at [{{DOMAIN}}](https://{{DOMAIN}}).

## Contributing

Read [CONTRIBUTING.md](.github/CONTRIBUTING.md). Run `pnpm verify` before you open a pull request.

## Support and security

Ask questions in the [Lupinum OSS Discord](https://discord.lupinum.com). Report vulnerabilities privately as described in [SECURITY.md](.github/SECURITY.md).

## License

[MIT](LICENSE) © Lupinum OG.
