#!/usr/bin/env node
// Generates each starter into a temporary directory, checks it with the
// standard's audit (scripts/audit.mjs), installs it from scratch and runs its
// own `pnpm verify`. Library starters also run the release pack step, so the
// tarballs the release workflow would publish are really produced and carry
// their versioned agent docs.
// Needs the root dependencies (`pnpm install`) for the audit.
//
// Usage: node scripts/verify-starters.mjs [library] [library-monorepo] [app]
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
// The quotes in the library title check that setup encodes input for every file type.
const starters = {
  'library': { tarballs: 1, args: ['--title', 'Bob\'s "test" library', '--package', '@lupinum/test-library'] },
  'library-monorepo': {
    tarballs: 2,
    args: ['--title', 'Test monorepo', '--package', '@lupinum/test-core', '--package', '@lupinum/test-vue', '--primary', '@lupinum/test-vue'],
  },
  'app': { tarballs: 0, args: ['--title', 'Test app'] },
}

const selected = process.argv.slice(2)
for (const name of selected) {
  if (!starters[name]) throw new Error(`Unknown starter ${name}. Choose from: ${Object.keys(starters).join(', ')}.`)
}

function run(command, args, cwd) {
  console.log(`\n$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`\`${[command, ...args].join(' ')}\` failed in ${cwd}.`)
}

const workspace = await mkdtemp(join(tmpdir(), 'lupinum-starters-'))
try {
  for (const name of selected.length ? selected : Object.keys(starters)) {
    const { args, tarballs } = starters[name]
    const output = join(workspace, name)
    run(process.execPath, [
      join(root, 'starters', name, 'setup.mjs'),
      '--output', output,
      '--name', `test-${name}`,
      '--description', 'A generated starter test.',
      '--repository', `lupinum-dev/test-${name}`,
      '--domain', `test-${name}.lupinum.com`,
      '--plausible', 'test-script-id',
      ...args,
    ], root)
    run(process.execPath, [join(root, 'scripts', 'audit.mjs'), '--local', output], root)
    // A new repository has no lockfile yet; its first install creates one.
    run('pnpm', ['install', '--no-frozen-lockfile'], output)
    run('pnpm', ['verify'], output)
    if (tarballs) {
      run(process.execPath, ['scripts/release.mjs', 'pack'], output)
      const packed = (await readdir(join(output, 'release'))).filter(file => file.endsWith('.tgz'))
      if (packed.length !== tarballs) throw new Error(`${name}: expected ${tarballs} release tarball(s), found ${packed.length}.`)
      // Consumers' agents resolve `<package>/agent-docs`; every tarball must ship it.
      for (const file of packed) {
        const listing = spawnSync('tar', ['-tzf', join(output, 'release', file)], { encoding: 'utf8' }).stdout
        if (!listing.includes('package/dist/agent/AGENTS.md')) throw new Error(`${name}: ${file} does not contain dist/agent/AGENTS.md.`)
      }
    }
    console.log(`\n${name}: generated repository passes pnpm verify.`)
  }
}
finally {
  await rm(workspace, { recursive: true, force: true })
}
