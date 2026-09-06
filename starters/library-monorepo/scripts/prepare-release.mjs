import { readFile, readdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

if (process.argv.length > 2) throw new Error('Changesets derives versions. Run release:prepare without arguments.')
const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
if (status.status !== 0) throw new Error(status.stderr || 'Cannot inspect the worktree.')
if (status.stdout.trim()) throw new Error('Release preparation requires a clean worktree. Commit the reviewed Changesets first.')
const directories = (await readdir('packages', { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
const manifests = await Promise.all(directories.map(async directory => JSON.parse(await readFile(`packages/${directory}/package.json`, 'utf8'))))
const names = manifests.filter(manifest => !manifest.private).map(manifest => manifest.name).sort()
const config = JSON.parse(await readFile('.changeset/config.json', 'utf8'))
if (names.length < 2 || config.fixed?.length !== 1 || JSON.stringify([...config.fixed[0]].sort()) !== JSON.stringify(names)) {
  throw new Error('Changesets must fix every public package in one explicit group.')
}
const beforeVersions = new Set(manifests.filter(manifest => !manifest.private).map(manifest => manifest.version))
if (beforeVersions.size !== 1) throw new Error('Public packages must start on one fixed version.')

const preparation = spawnSync('pnpm', ['exec', 'changeset', 'version'], { stdio: 'inherit' })
if (preparation.status !== 0) throw new Error('Changesets version preparation failed.')
const updated = await Promise.all(directories.map(async directory => JSON.parse(await readFile(`packages/${directory}/package.json`, 'utf8'))))
const versions = new Set(updated.filter(manifest => !manifest.private).map(manifest => manifest.version))
if (versions.size !== 1) throw new Error('Changesets did not produce one fixed package version.')
const [version] = versions
if (beforeVersions.has(version)) throw new Error('No new release was prepared. Add a reviewed Changeset or exit prerelease mode.')

// Changesets owns versions. Changelogen only supplies the root release notes.
const changelog = spawnSync('pnpm', ['exec', 'changelogen', '--no-output', '--hideAuthorEmail'], { encoding: 'utf8' })
if (changelog.status !== 0) throw new Error(changelog.stderr || 'Changelogen failed.')
const generated = /^##\s+[^\n]+\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(changelog.stdout.replaceAll('\r\n', '\n'))
if (!generated?.[1].trim()) throw new Error('Changelogen did not produce non-empty release notes.')
const current = await readFile('CHANGELOG.md', 'utf8')
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
if (new RegExp(`^##\\s+v?${escapedVersion}(?:\\s|$)`, 'm').test(current)) throw new Error('The prepared version already has release notes.')
const section = `## v${version}\n\n${generated[1].trim()}\n\n`
const firstRelease = current.search(/^##\s/m)
await writeFile('CHANGELOG.md', firstRelease < 0 ? `${current.trimEnd()}\n\n${section}` : `${current.slice(0, firstRelease)}${section}${current.slice(firstRelease)}`)
const lockfile = spawnSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--no-frozen-lockfile'], { stdio: 'inherit' })
if (lockfile.status !== 0) throw new Error('Cannot synchronize the lockfile after version preparation.')
console.log(`Prepared fixed package version ${version}.`)
