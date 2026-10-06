import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
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

test('baseline uses the published matching dist-tag, shared tag naming and E404', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-baseline-'))
  mkdirSync(join(cwd, '.changeset'))
  mkdirSync(join(cwd, 'bin'))
  writeFileSync(join(cwd, '.changeset/config.json'), '{}')
  writeFileSync(join(cwd, 'pnpm-workspace.yaml'), 'packages: []\n')
  const npm = join(cwd, 'bin/npm')
  // npm is the external registry boundary; pnpm reads a real local workspace.
  writeFileSync(npm, '#!/bin/sh\ncase "$2" in *@next) echo 1.2.0-next.3;; *@latest) echo 1.1.0;; *) echo E404 >&2; exit 1;; esac\n')
  chmodSync(npm, 0o755)
  const check = version => {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: '@lupinum/example', version, packageManager: 'pnpm@11.21.0' }))
    return spawnSync(process.execPath, [script, 'baseline'], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${join(cwd, 'bin')}:${process.env.PATH}` } })
  }
  assert.equal(check('1.2.0-next.4').stdout.trim(), 'v1.2.0-next.3')
  assert.equal(check('1.2.0').stdout.trim(), 'v1.1.0')
  mkdirSync(join(cwd, 'packages/second'), { recursive: true })
  writeFileSync(join(cwd, 'packages/second/package.json'), JSON.stringify({ name: '@lupinum/second', version: '1.2.0' }))
  writeFileSync(join(cwd, 'pnpm-workspace.yaml'), 'packages: [packages/*]\n')
  assert.equal(check('1.2.0').stdout.trim(), '@lupinum/example@1.1.0\n@lupinum/second@1.1.0')
  writeFileSync(join(cwd, '.changeset/config.json'), '{"fixed":[["@lupinum/*"]]}')
  assert.equal(check('1.2.0').stdout.trim(), 'v1.1.0')
  writeFileSync(npm, '#!/bin/sh\necho E404 >&2\nexit 1\n')
  const missing = check('1.2.0')
  assert.equal(missing.status, 0)
  assert.equal(missing.stdout, '')
})
