import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const fixture = await mkdtemp(path.join(os.tmpdir(), 'lupinum-docs-output-'))
const asset = path.join(fixture, '_nuxt', 'entry.js')

try {
  await mkdir(path.dirname(asset), { recursive: true })
  await writeFile(path.join(fixture, 'index.html'), '<script src="/_nuxt/entry.js"></script>')
  await writeFile(asset, 'export {}')

  const valid = verifyFixture()
  if (valid.status !== 0) {
    throw new Error(`Valid documentation output failed verification:\n${valid.stderr}`)
  }

  await rm(asset)
  const invalid = verifyFixture()
  if (invalid.status === 0 || !invalid.stderr.includes('_nuxt/entry.js')) {
    throw new Error('Missing documentation assets did not fail verification.')
  }
}
finally {
  await rm(fixture, { force: true, recursive: true })
}

function verifyFixture() {
  return spawnSync(process.execPath, ['scripts/verify-docs-output.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DOCS_OUTPUT_ROOT: fixture },
  })
}

console.log('Documentation output verification tests passed.')
