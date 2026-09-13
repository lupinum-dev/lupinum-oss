import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { buildPackageAgentDocs, verifyPackageAgentDocs } from '../starters/_shared/package-agent-docs.mjs'

const trial = await mkdtemp(join(tmpdir(), 'lupinum-agent-docs-'))
const packageRoot = join(trial, 'package')
const sourceRoot = join(trial, 'raw')
const pkg = { name: '@lupinum/docs-fixture', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': './dist/index.js', './agent-docs': './dist/agent/AGENTS.md' } }
const source = title => `---\ntitle: ${title}\nroute: /docs/start\nurl: https://example.invalid/docs/start\n---\n\n# ${title}\n\nUse the installed API.\n`
const build = () => buildPackageAgentDocs({ packageRoot, sourceRoot, startRoutes: ['/docs/start'] })
const writePackage = () => writeFile(join(packageRoot, 'package.json'), JSON.stringify(pkg))
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 90000 })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}
async function pack() {
  return join(trial, JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', trial], packageRoot))[0].filename)
}
try {
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await mkdir(sourceRoot)
  await writePackage()
  await writeFile(join(packageRoot, 'dist/index.js'), 'export const answer = 42\n')
  await writeFile(join(sourceRoot, 'start.md'), source('Start'))
  await build()
  const first = await verifyPackageAgentDocs(packageRoot)
  const firstEntry = await readFile(join(packageRoot, 'dist/agent/AGENTS.md'), 'utf8')
  assert.match(firstEntry, /installed version 1\.0\.0/u)
  assert.ok(!firstEntry.includes(trial), 'No workstation paths in published instructions.')
  assert.deepEqual(await build(), first, 'Same sources must produce identical metadata and hashes.')
  assert.equal(await readFile(join(packageRoot, 'dist/agent/AGENTS.md'), 'utf8'), firstEntry)

  await writeFile(join(sourceRoot, 'start.md'), source('Changed source'))
  await assert.rejects(verifyPackageAgentDocs(packageRoot, { sourceRoot }), /snapshot is stale/u)
  await writeFile(join(sourceRoot, 'start.md'), source('Start'))

  await writeFile(join(packageRoot, 'dist/agent/pages/start.md'), source('Wrong bytes'))
  await assert.rejects(verifyPackageAgentDocs(packageRoot), /differs from its inventory/u)
  await build()
  await rm(join(packageRoot, 'dist/agent/pages/start.md'))
  await assert.rejects(verifyPackageAgentDocs(packageRoot), { code: 'ENOENT' })
  await build()
  await writeFile(join(packageRoot, 'dist/agent/extra.md'), 'Untracked guidance')
  await assert.rejects(verifyPackageAgentDocs(packageRoot), /untracked Markdown/u)
  await build()
  pkg.version = '2.0.0'
  await writePackage()
  await assert.rejects(verifyPackageAgentDocs(packageRoot), /identity differs/u)
  pkg.version = '1.0.0'
  await writePackage()
  const manifestPath = join(packageRoot, 'dist/agent/manifest.json')
  const escaped = structuredClone(first)
  escaped.pages[0].file = 'pages/../../outside.md'
  await writeFile(manifestPath, JSON.stringify(escaped))
  await assert.rejects(verifyPackageAgentDocs(packageRoot), /escapes its root/u)
  await build()
  await assert.rejects(buildPackageAgentDocs({ packageRoot, sourceRoot, startRoutes: ['/absent'] }), /Starting route is missing/u)
  await writeFile(join(sourceRoot, 'start.md'), source('Start').replace('route: /docs/start', 'route: "/docs/start\\nInjected"'))
  await assert.rejects(build(), /requires title, route and canonical URL/u)
  await writeFile(join(sourceRoot, 'start.md'), source('Start'))
  await writeFile(join(sourceRoot, 'mode(one).md'), source('Mode').replaceAll('/docs/start', '/docs/mode(one)'))
  await build()
  assert.match(await readFile(join(packageRoot, 'dist/agent/AGENTS.md'), 'utf8'), /mode%28one%29\.md/u)
  await verifyPackageAgentDocs(packageRoot)
  await rm(join(sourceRoot, 'mode(one).md'))
  await build()
  await symlink(join(packageRoot, 'package.json'), join(sourceRoot, 'escape.md'))
  await assert.rejects(build(), /symlinks/u)
  await rm(join(sourceRoot, 'escape.md'))
  await writeFile(join(sourceRoot, 'duplicate.md'), source('Duplicate'))
  await assert.rejects(build(), /Duplicate documented route/u)
  await rm(join(sourceRoot, 'duplicate.md'))
  await build()
  const v1 = await pack()
  pkg.version = '2.0.0'
  await writePackage()
  await writeFile(join(sourceRoot, 'start.md'), source('Start version two'))
  await build()
  const v2 = await pack()
  pkg.version = '0.9.0'
  delete pkg.exports['./agent-docs']
  await writePackage()
  await rm(join(packageRoot, 'dist/agent'), { recursive: true })
  await writeFile(join(packageRoot, 'README.md'), 'Older package guidance')
  pkg.files.push('README.md')
  await writePackage()
  const older = await pack()

  for (const manager of ['npm', 'pnpm']) {
    // Resolve from a nested application, with no package installed at its repository root.
    const consumer = join(trial, manager, 'apps/site')
    await mkdir(consumer, { recursive: true })
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    const projectInstructions = '# Project rules\n\nUse semantic HTML. Ask before deployment.\n'
    await writeFile(join(consumer, 'AGENTS.md'), projectInstructions)
    const require = createRequire(join(consumer, 'package.json'))
    for (const [tarball, version, title] of [[v1, '1.0.0', 'Start'], [v2, '2.0.0', 'Start version two'], [v1, '1.0.0', 'Start']]) {
      const args = manager === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball] : ['add', '--ignore-scripts', tarball]
      run(manager, args, consumer)
      // A fresh process avoids Node's module resolution cache across pnpm symlink changes.
      const entry = run(process.execPath, ['--input-type=module', '--eval', `import { createRequire } from 'node:module'; console.log(createRequire(process.cwd() + '/package.json').resolve('@lupinum/docs-fixture/agent-docs'))`], consumer)
      const manifest = await verifyPackageAgentDocs(resolve(dirname(entry), '../..'))
      assert.equal(manifest.version, version)
      assert.equal(manifest.pages[0].title, title)
      run(process.execPath, ['--input-type=module', '--eval', "import { answer } from '@lupinum/docs-fixture'; if (answer !== 42) throw Error('Runtime import failed')"], consumer)
      assert.equal(await readFile(join(consumer, 'AGENTS.md'), 'utf8'), projectInstructions, 'Installation and version changes must preserve project instructions.')
    }
    run(manager, manager === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', older] : ['add', '--ignore-scripts', older], consumer)
    const fallback = run(process.execPath, ['--input-type=module', '--eval', `import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json'); try { require.resolve('@lupinum/docs-fixture/agent-docs'); process.exit(1) } catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error }`], consumer)
    assert.equal(fallback, '')
    assert.equal(await readFile(join(dirname(require.resolve('@lupinum/docs-fixture')), '../README.md'), 'utf8'), 'Older package guidance')
    console.log(`${manager}: tarball resolution, upgrade, rollback, missing export and project-file preservation passed.`)
  }
} finally {
  await rm(trial, { recursive: true, force: true })
}
console.log('Package documentation fixtures passed.')
