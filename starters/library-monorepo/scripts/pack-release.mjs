import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const preview = process.argv.includes('--preview')
const directory = preview ? '.preview-artifacts' : 'release-artifacts'
const packages = ['{{PACKAGE_1_DIR}}', '{{PACKAGE_2_DIR}}']
await rm(directory, { recursive: true, force: true })
await mkdir(directory, { recursive: true })
const records = []
for (const packageDirectory of packages) {
  const packagePath = `packages/${packageDirectory}`
  const manifest = JSON.parse(await readFile(`${packagePath}/package.json`, 'utf8'))
  const result = spawnSync('pnpm', ['--dir', packagePath, '--config.ignore-scripts=true', 'pack', '--pack-destination', resolve(directory)], {
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? resolve('.npm-cache') },
  })
  if (result.status !== 0) throw new Error(result.stderr || `npm pack failed for ${packageDirectory}.`)
  const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
  const bytes = await readFile(`${directory}/${filename}`)
  records.push({ name: manifest.name, version: manifest.version, filename, sha256: createHash('sha256').update(bytes).digest('hex') })
}
if (new Set(records.map(record => record.version)).size !== 1) throw new Error('All packages must use one fixed version.')
const sourceSha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
const version = records[0].version
const changelog = await readFile('CHANGELOG.md', 'utf8')
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const matches = [...changelog.matchAll(new RegExp(`^##\\s+v?${escapedVersion}(?:\\s|$)[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'gm'))]
if (matches.length !== 1 || !matches[0][1].trim()) throw new Error(`CHANGELOG.md must contain exactly one non-empty ${version} release.`)
await copyFile('CHANGELOG.md', `${directory}/CHANGELOG.md`)
await writeFile(`${directory}/release-notes.md`, `${matches[0][1].trim()}\n`)
const changelogBytes = await readFile(`${directory}/CHANGELOG.md`)
const notesBytes = await readFile(`${directory}/release-notes.md`)
await writeFile(`${directory}/SHA256SUMS`, [
  ...records.map(record => `${record.sha256}  ${record.filename}`),
  `${createHash('sha256').update(changelogBytes).digest('hex')}  CHANGELOG.md`,
  `${createHash('sha256').update(notesBytes).digest('hex')}  release-notes.md`,
].join('\n') + '\n')
await writeFile(`${directory}/release.json`, `${JSON.stringify({ version, sourceSha, packages: records }, null, 2)}\n`)
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `directory=${directory}\nmanifest=${directory}/release.json\n`)
console.log(JSON.stringify({ directory, packages: records }))
