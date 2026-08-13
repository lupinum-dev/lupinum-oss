import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const preview = process.argv.includes('--preview')
const directory = preview ? '.preview-artifacts' : 'release-artifacts'
await rm(directory, { recursive: true, force: true })
await mkdir(directory, { recursive: true })
const result = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', directory], {
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? resolve('.npm-cache') },
})
if (result.status !== 0) throw new Error(result.stderr || 'npm pack failed.')
const filename = result.stdout.trim().split('\n').at(-1)
const bytes = await readFile(`${directory}/${filename}`)
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const sha256 = createHash('sha256').update(bytes).digest('hex')
const sourceSha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
const changelog = await readFile('CHANGELOG.md', 'utf8')
const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const matches = [...changelog.matchAll(new RegExp(`^##\\s+v?${escapedVersion}(?:\\s|$)[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'gm'))]
if (matches.length !== 1 || !matches[0][1].trim()) throw new Error(`CHANGELOG.md must contain exactly one non-empty ${packageJson.version} release.`)
await copyFile('CHANGELOG.md', `${directory}/CHANGELOG.md`)
await writeFile(`${directory}/release-notes.md`, `${matches[0][1].trim()}\n`)
const changelogBytes = await readFile(`${directory}/CHANGELOG.md`)
const notesBytes = await readFile(`${directory}/release-notes.md`)
await writeFile(`${directory}/SHA256SUMS`, [
  `${sha256}  ${filename}`,
  `${createHash('sha256').update(changelogBytes).digest('hex')}  CHANGELOG.md`,
  `${createHash('sha256').update(notesBytes).digest('hex')}  release-notes.md`,
].join('\n') + '\n')
await writeFile(`${directory}/release.json`, `${JSON.stringify({ name: packageJson.name, version: packageJson.version, filename, sha256, sourceSha, packages: [{ name: packageJson.name, filename, sha256 }] }, null, 2)}\n`)
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `directory=${directory}\nmanifest=${directory}/release.json\n`)
console.log(JSON.stringify({ directory, filename, name: packageJson.name, sha256 }))
