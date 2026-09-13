import { readdir, readFile } from 'node:fs/promises'
import { buildPackageAgentDocs } from './package-agent-docs.mjs'

for (const directory of await readdir('packages', { withFileTypes: true })) {
  if (!directory.isDirectory()) continue
  const packageRoot = `packages/${directory.name}`
  const pkg = JSON.parse(await readFile(`${packageRoot}/package.json`, 'utf8'))
  if (pkg.private) continue
  await buildPackageAgentDocs({
    packageRoot,
    sourceRoot: 'docs/.output/public/raw',
    startRoutes: ['/docs/getting-started'],
  })
}
