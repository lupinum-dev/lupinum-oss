import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
const script = fileURLToPath(new URL('../starters/_shared/library/scripts/release.mjs', import.meta.url))

test('version-needed sees pending changesets and prerelease exit without a changeset', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-needed-'))
  mkdirSync(join(cwd, '.changeset'))
  const check = () => spawnSync(process.execPath, [script, 'version-needed'], { cwd, encoding: 'utf8' }).stdout.trim()
  writeFileSync(join(cwd, '.changeset/README.md'), '# Readme')
  mkdirSync(join(cwd, '.changeset/pre'))
  writeFileSync(join(cwd, '.changeset/pre/archived.md'), 'archived')
  assert.equal(check(), 'false')
  writeFileSync(join(cwd, '.changeset/pre.json'), '{"mode":"exit"}')
  assert.equal(check(), 'true')
  writeFileSync(join(cwd, '.changeset/pre.json'), '{"mode":"pre"}')
  assert.equal(check(), 'false')
  writeFileSync(join(cwd, '.changeset/minor.md'), 'pending')
  assert.equal(check(), 'true')
})

test('pack names tarballs so a dependency publishes before its dependent', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-order-'))
  const scope = `@lupinum-order-test-${process.pid}`
  const pkg = (dir, name, dependencies = {}) => {
    mkdirSync(join(cwd, 'packages', dir), { recursive: true })
    writeFileSync(join(cwd, 'packages', dir, 'package.json'), JSON.stringify({ name: `${scope}/${name}`, version: '1.0.0', dependencies }))
  }
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'root', private: true }))
  writeFileSync(join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  mkdirSync(join(cwd, '.changeset'))
  writeFileSync(join(cwd, '.changeset/config.json'), JSON.stringify({ fixed: [[`${scope}/*`]] }))
  // Alphabetical order would publish the module first.
  pkg('a-module', 'a-module', { [`${scope}/z-core`]: 'workspace:*' })
  pkg('z-core', 'z-core')
  const result = spawnSync(process.execPath, [script, 'pack'], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const tarballs = readdirSync(join(cwd, 'release')).filter(file => file.endsWith('.tgz')).sort()
  assert.equal(tarballs.length, 2)
  assert.match(tarballs[0], /^01-.*z-core-1\.0\.0\.tgz$/)
  assert.match(tarballs[1], /^02-.*a-module-1\.0\.0\.tgz$/)
})
