import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const release = JSON.parse(await readFile('release-artifacts/release.json', 'utf8'))
const consumer = await mkdtemp(join(tmpdir(), 'lupinum-packed-consumer-'))

try {
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  const tarballs = release.packages.map(pkg => resolve('release-artifacts', pkg.filename))
  const install = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], {
    cwd: consumer,
    encoding: 'utf8',
  })
  if (install.status !== 0) throw new Error(install.stderr || 'Packed consumer installation failed.')
  const packageNames = release.packages.map(pkg => pkg.name)
  const verify = spawnSync(process.execPath, ['--input-type=module', '--eval', `for (const name of ${JSON.stringify(packageNames)}) { const mod = await import(name); if (Object.keys(mod).length === 0) throw new Error(name + ' has no public exports.') }`], {
    cwd: consumer,
    encoding: 'utf8',
  })
  if (verify.status !== 0) throw new Error(verify.stderr || 'Packed consumer import failed.')
} finally {
  await rm(consumer, { recursive: true, force: true })
}

console.log(`Verified packed consumers for ${release.packages.map(pkg => pkg.name).join(', ')}.`)
