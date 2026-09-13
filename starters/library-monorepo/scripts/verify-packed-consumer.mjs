import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { verifyPackageAgentDocs } from './package-agent-docs.mjs'

const release = JSON.parse(await readFile('release-artifacts/release.json', 'utf8'))
const tarballs = release.packages.map(pkg => resolve('release-artifacts', pkg.filename))
for (const manager of ['npm', 'pnpm']) {
  const consumer = await mkdtemp(join(tmpdir(), 'lupinum-packed-consumer-'))
  try {
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    const args = manager === 'npm'
      ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs]
      : ['add', '--ignore-scripts', ...tarballs]
    const install = spawnSync(manager, args, { cwd: consumer, encoding: 'utf8', timeout: 120000 })
    if (install.status !== 0) throw new Error(install.error?.message || install.stderr || 'Packed consumer installation failed.')
    const require = createRequire(join(consumer, 'package.json'))
    for (const pkg of release.packages) {
      const entry = require.resolve(`${pkg.name}/agent-docs`)
      const docs = await verifyPackageAgentDocs(resolve(dirname(entry), '../..'))
      if (docs.name !== pkg.name || docs.version !== pkg.version) throw new Error('Installed documentation differs from the release candidate.')
    }
    const packageNames = release.packages.map(pkg => pkg.name)
    const verify = spawnSync(process.execPath, ['--input-type=module', '--eval', `for (const name of ${JSON.stringify(packageNames)}) { const mod = await import(name); const item = mod.createItem('one', 'First item'); if (item.id !== 'one' || item.label !== 'First item') throw new Error('Unexpected public API.') }`], {
      cwd: consumer,
      encoding: 'utf8',
      timeout: 30000,
    })
    if (verify.status !== 0) throw new Error(verify.error?.message || verify.stderr || 'Packed consumer example failed.')
    console.log(`${manager}: verified public examples and versioned docs for ${packageNames.join(', ')}.`)
  } finally {
    await rm(consumer, { recursive: true, force: true })
  }
}
