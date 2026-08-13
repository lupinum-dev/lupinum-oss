import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const versionIndex = process.argv.indexOf('--version')
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : undefined
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Pass an exact SemVer with --version.')
const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim()
if (status) throw new Error('Release preparation requires a clean worktree.')
const changelog = spawnSync('pnpm', ['exec', 'changelogen', '--output', 'CHANGELOG.md'], { stdio: 'inherit' })
if (changelog.status !== 0) throw new Error('Changelogen failed.')
for (const directory of ['{{PACKAGE_1_DIR}}', '{{PACKAGE_2_DIR}}']) {
  const path = `packages/${directory}/package.json`
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.version = version
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
}
console.log(`Prepared fixed package version ${version}.`)
