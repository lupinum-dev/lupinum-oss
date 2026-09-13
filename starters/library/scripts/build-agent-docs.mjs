import { buildPackageAgentDocs } from './package-agent-docs.mjs'

await buildPackageAgentDocs({
  packageRoot: '.',
  sourceRoot: 'docs/.output/public/raw',
  startRoutes: ['/docs/getting-started'],
})
