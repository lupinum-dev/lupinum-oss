import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { auditFiles, auditSettings, compareVersions, localSource, checklistItems, stageReached } from './audit.mjs'

const sha = 'a'.repeat(40)
const library = {
  'package.json': JSON.stringify({ name: '@lupinum/example', exports: { './agent-docs': './dist/agent/AGENTS.md' }, files: ['dist'], packageManager: 'pnpm@11.21.0', scripts: Object.fromEntries(['build', 'lint', 'typecheck', 'test', 'changeset'].map(s => [s, s]).concat([['verify', 'pnpm audit && pnpm test']])) }),
  'pnpm-workspace.yaml': 'minimumReleaseAge: 1440\nallowBuilds:\n  esbuild: true\n',
  'renovate.json': '{ "minimumReleaseAge": "1 day" }',
  '.changeset/config.json': '{ "changelog": ["@changesets/changelog-github", { "repo": "lupinum-dev/example" }] }',
  '.github/workflows/ci.yml': `on: pull_request\npermissions: { contents: read }\njobs:\n  ci:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${sha}\n      - run: pnpm verify\n`,
  '.github/workflows/preview.yml': `on: pull_request\npermissions: { contents: read }\njobs:\n  preview:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: pnpm dlx pkg-pr-new publish\n`,
  '.github/workflows/release.yml': `on: { push: { branches: [main] } }
permissions: { contents: read }
jobs:
  version-prepare:
    runs-on: ubuntu-24.04
    permissions: { contents: read, pull-requests: read }
    steps:
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm exec changeset version
  version-pr:
    runs-on: ubuntu-24.04
    permissions: { contents: write, pull-requests: write }
    steps:
      - run: git push --force origin HEAD:refs/heads/changeset-release/main
  publish:
    runs-on: ubuntu-24.04
    environment: npm
    permissions: { id-token: write }
    steps:
      - uses: actions/download-artifact@${sha}
      - run: npm publish ./package.tgz --provenance --access public --ignore-scripts --tag latest
`,
  ...Object.fromEntries(['LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md'].map(f => [f, '#'])),
  'DECISIONS.md': 'Keep release.yml, preview.yml, release.mjs, lint-changesets.mjs and agent-docs.mjs for this test fixture.',
  'README.md': '## Agent setup\n\nRead `node_modules/@lupinum/example/dist/agent/AGENTS.md`.\n',
}

function audit(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lupinum-audit-'))
  for (const [file, content] of Object.entries({ ...library, ...overrides })) {
    if (content === null) continue
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
  return Object.fromEntries(auditFiles(localSource(dir)).map(r => [r.id, r]))
}

test('a standard library passes every file check', () => {
  const failing = Object.values(audit()).filter(r => r.status !== 'pass')
  assert.deepEqual(failing, [])
})

test('real attack paths fail', () => {
  const release = library['.github/workflows/release.yml']
  assert.equal(audit({ '.github/workflows/release.yml': release.replace('environment: npm\n', '') })['FILE-04'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': release.replace('--provenance ', '') })['FILE-04'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': release.replace('      - uses: actions/download', '      - uses: actions/checkout@' + sha + '\n      - uses: actions/download') })['FILE-04'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': `${release}        env: { NODE_AUTH_TOKEN: x }\n` })['FILE-04'].status, 'fail')
  assert.equal(audit({ '.github/workflows/ci.yml': library['.github/workflows/ci.yml'].replace(sha, 'v4') })['FILE-03'].status, 'fail')
  assert.equal(audit({ '.github/workflows/ci.yml': library['.github/workflows/ci.yml'].replace('contents: read', 'contents: write') })['FILE-03'].status, 'fail')
  assert.equal(audit({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 60\n' })['FILE-06'].status, 'fail')
  // A job that can push, open pull requests or start ci must not run dependency or repository code.
  const prJob = '    permissions: { contents: write, pull-requests: write }\n    steps:\n'
  for (const [permissions, run] of [
    ['{ contents: write, pull-requests: write, actions: write }', 'pnpm install --frozen-lockfile'],
    ['{ contents: write, pull-requests: write }', 'pnpm install --frozen-lockfile'],
    ['{ contents: write, pull-requests: write }', 'pnpm run version-packages'],
    ['{ contents: write }', 'node scripts/release.mjs tag'],
    ['write-all', 'npx changeset version'],
  ]) {
    assert.equal(audit({ '.github/workflows/release.yml': release.replace(prJob, `    permissions: ${permissions}\n    steps:\n      - run: ${run}\n`) })['FILE-03'].status, 'fail', `${permissions} + ${run}`)
  }
})

test('agents in consuming projects can find the docs of the installed version', () => {
  const pkg = JSON.parse(library['package.json'])
  const without = (key) => JSON.stringify({ ...pkg, [key]: undefined })
  assert.equal(audit({ 'package.json': without('exports') })['FILE-11'].status, 'fail')
  assert.equal(audit({ 'package.json': JSON.stringify({ ...pkg, files: ['dist/index.js'] }) })['FILE-11'].status, 'fail')
  assert.equal(audit({ 'package.json': JSON.stringify({ ...pkg, files: ['dis'] }) })['FILE-11'].status, 'fail')
  assert.equal(audit({ 'package.json': JSON.stringify({ ...pkg, files: ['dist/**'] }) })['FILE-11'].status, 'pass')
  assert.equal(audit({ 'README.md': '# Example\n\nThe agent-docs export is not supported.\n' })['FILE-11'].status, 'fail')
  // In a monorepo, npm shows each package's own README, so each needs the section.
  const workspace = { 'pnpm-workspace.yaml': `${library['pnpm-workspace.yaml']}packages:\n  - packages/*\n`, 'packages/vue/package.json': JSON.stringify({ ...pkg, name: '@lupinum/example-vue' }) }
  assert.equal(audit({ ...workspace, 'packages/vue/README.md': '# Vue\n' })['FILE-11'].status, 'fail')
  assert.equal(audit({ ...workspace, 'packages/vue/README.md': library['README.md'] })['FILE-11'].status, 'fail')
  assert.equal(audit({ ...workspace, 'packages/vue/README.md': library['README.md'].replace('example/', 'example-vue/') })['FILE-11'].status, 'pass')
})

test('a write-capable job may not run repository files through a shell, an interpreter or make', () => {
  const release = library['.github/workflows/release.yml']
  const prJob = '    permissions: { contents: write, pull-requests: write }\n    steps:\n'
  const withRun = run => release.replace(prJob, `${prJob}      - run: |\n          ${run.replaceAll('\n', '\n          ')}\n`)
  for (const run of [
    'bash ./scripts/release.sh',
    'sh scripts/release.sh',
    'bash -e scripts/release.sh',
    './scripts/release',
    'cd packages/a && ../../scripts/release',
    'FOO=1 ./scripts/release',
    'source ./scripts/env.sh',
    '. scripts/env.sh',
    'python3 scripts/release.py',
    'ruby scripts/release.rb',
    'make release',
    'if make check; then echo ok; fi',
    'out="$(./scripts/x)"',
  ]) {
    assert.equal(audit({ '.github/workflows/release.yml': withRun(run) })['FILE-03'].status, 'fail', run)
  }
  for (const run of [
    'bash -c \'echo hi\'',
    'git apply --index ./version.patch',
    'jq -r \'.[] | . as $p | $p.name\' "$RUNNER_TEMP/versions.json"',
    'jq \'if .a then . else . end\' ./file.json',
    'echo "make sure main is green; run sh scripts yourself"',
  ]) {
    assert.equal(audit({ '.github/workflows/release.yml': withRun(run) })['FILE-03'].status, 'pass', run)
  }
  // The starter's release.yml uses only git, gh, jq and inline shell in its write jobs.
  const starter = readFileSync(new URL('../starters/_shared/library/.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.equal(audit({ '.github/workflows/release.yml': starter })['FILE-03'].status, 'pass')
})

test('pnpm audit through a CI matrix counts', () => {
  const ci = `on: pull_request\npermissions: { contents: read }\njobs:\n  check:\n    runs-on: ubuntu-24.04\n    strategy: { matrix: { task: [lint, audit] } }\n    steps:\n      - run: pnpm \${{ matrix.task }}\n  ci:\n    needs: check\n    runs-on: ubuntu-24.04\n    steps:\n      - run: 'true'\n`
  assert.equal(audit({ '.github/workflows/ci.yml': ci })['FILE-02'].status, 'pass')
  assert.equal(audit({ '.github/workflows/ci.yml': ci.replace('lint, audit', 'lint') })['FILE-02'].status, 'fail')
})

test('excess tooling warns', () => {
  const result = audit({ 'MAINTAINING.md': '#', '.github/workflows/extra.yml': 'on: push\npermissions: {}\njobs: {}\n' })
  assert.equal(result['FILE-08'].status, 'warn')
  assert.equal(result['FILE-01'].status, 'warn')
})

test('an extra workflow named in DECISIONS.md passes', () => {
  const extra = { '.github/workflows/extra.yml': 'on: push\npermissions: {}\njobs: {}\n' }
  assert.equal(audit({ ...extra, 'DECISIONS.md': '- D2 (2026-09-27): Keep extra.yml — it runs a slow weekly check.' })['FILE-01'].status, 'pass')
})

test('a publish dry run outside the npm environment passes; a real publish there fails', () => {
  const release = library['.github/workflows/release.yml']
  const pack = `  pack:\n    runs-on: ubuntu-24.04\n    permissions: { contents: read }\n    steps:\n      - uses: actions/checkout@${sha}\n      - run: npm publish ./package.tgz --dry-run --access public --ignore-scripts --tag next\n`
  assert.equal(audit({ '.github/workflows/release.yml': `${release}${pack}` })['FILE-04'].status, 'pass')
  assert.equal(audit({ '.github/workflows/release.yml': `${release}${pack.replace(' --dry-run', '')}` })['FILE-04'].status, 'fail')
})

test('the Changesets CLI runs without a write token', () => {
  const release = library['.github/workflows/release.yml']
  const readOnly = '    permissions: { contents: read, pull-requests: read }\n'
  assert.equal(audit({ '.github/workflows/release.yml': release.replace(readOnly, '    permissions: { contents: write, pull-requests: read }\n') })['FILE-05'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': release.replace(readOnly, '    permissions: { contents: read, pull-requests: write }\n') })['FILE-05'].status, 'fail')
  const action = release.replace('      - run: pnpm exec changeset version\n', `      - uses: changesets/action@${sha}\n`).replace(readOnly, '    permissions: { contents: write, pull-requests: write }\n')
  assert.equal(audit({ '.github/workflows/release.yml': action })['FILE-05'].status, 'fail')
  // changelog-github is the starter default, not a requirement.
  assert.equal(audit({ '.changeset/config.json': '{ "changelog": "@changesets/cli/changelog" }' })['FILE-05'].status, 'pass')
})

// ---------- settings ----------

const settings = {
  'repos/o/r': { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true, allow_auto_merge: false },
  'repos/o/r/vulnerability-alerts': null,
  'repos/o/r/private-vulnerability-reporting': { enabled: true },
  'repos/o/r/issues?state=open&per_page=100&page=1': [{ title: 'Dependency Dashboard', updated_at: '2026-10-02T00:00:00Z' }],
  'repos/o/r/pulls?state=open&per_page=100&page=1': [],
  'repos/o/r/releases?per_page=100&page=1': [{ tag_name: 'v1.2.0' }],
  'repos/o/r/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=1': { workflow_runs: [{ conclusion: 'success' }] },
  'repos/o/r/dependabot/alerts?state=open&severity=high,critical&per_page=100': [],
  'repos/o/r/branches?per_page=100&page=1': [{ name: 'main', commit: { sha: 'a' } }],
  'repos/o/r/rules/branches/main': [
    { type: 'pull_request', parameters: { required_approving_review_count: 0, allowed_merge_methods: ['squash'] } },
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci', integration_id: 15368 }] } },
    { type: 'non_fast_forward' },
    { type: 'required_linear_history' },
  ],
  'repos/o/r/rulesets?targets=tag&includes_parents=true': [{ id: 1, target: 'tag', enforcement: 'active' }],
  'repos/o/r/rulesets/1': { name: 'release tags', conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } }, rules: [{ type: 'update' }, { type: 'deletion' }], bypass_actors: [] },
  'repos/o/r/tags?per_page=100&page=1': [{ name: 'v1.2.0' }],
  'repos/o/r/actions/permissions/workflow': { default_workflow_permissions: 'read', can_approve_pull_request_reviews: true },
  'repos/o/r/environments/npm': {
    can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ reviewer: { login: 'maintainer' } }] }],
  },
  'repos/o/r/environments/npm/deployment-branch-policies': { branch_policies: [{ name: 'main', type: 'branch' }] },
  'repos/o/r/actions/secrets': { secrets: [] },
  'repos/o/r/environments/npm/secrets': { secrets: [] },
  'repos/o/r/code-scanning/default-setup': { state: 'configured' },
  'repos/o/r/automated-security-fixes': { enabled: false },
}
const provenance = version => ({ version, dist: { attestations: { provenance: {} } } })

async function auditRemote({ overrides = {}, meta = {}, publishes = true, tags = { latest: provenance('1.2.0') }, registry = async (_name, tag) => tag ? tags[tag] ?? null : { versions: { '1.2.0': {} }, time: { '1.2.0': '2026-10-01T00:00:00Z' } }, fetch = async () => ({ ok: true, status: 200, text: async () => '# Docs' }), fleet = [{ repository: 'o/r', evidence: Object.fromEntries(['NPM-01', 'NPM-02', 'DOC-03', 'DOC-04', 'DOC-05'].map(id => [id, '2026-10-03 checked'])) }], workspace = null } = {}) {
  const responses = { ...settings, ...overrides }
  const api = path => (responses[path] === undefined ? { ok: false, notFound: true, error: 'HTTP 404' } : { ok: true, data: responses[path] })
  const src = {
    repository: 'o/r',
    branch: 'main',
    meta: { allow_auto_merge: false, security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } }, ...meta },
    files: ['package.json'],
    read: path => ({ 'package.json': JSON.stringify({ name: '@lupinum/example', homepage: 'https://example.com' }), 'pnpm-workspace.yaml': workspace })[path] ?? null,
  }
  const results = await auditSettings(src, { publishes, api, registry, fetch, fleet, now: Date.parse('2026-10-03T00:00:00Z') })
  return Object.fromEntries(results.map(r => [r.id, r]))
}

test('standard settings pass', async () => {
  assert.deepEqual(Object.values(await auditRemote()).filter(r => r.status !== 'pass'), [])
})

test('the required ci check must come from GitHub Actions', async () => {
  const rules = settings['repos/o/r/rules/branches/main'].map(rule => rule.type === 'required_status_checks'
    ? { ...rule, parameters: { required_status_checks: [{ context: 'ci' }] } }
    : rule)
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/rules/branches/main': rules } }))['GH-01'].status, 'fail')
  assert.equal((await auditRemote({ meta: { allow_auto_merge: true } }))['GH-01'].status, 'fail')
})

test('release tags cannot be moved or deleted', async () => {
  const list = 'repos/o/r/rulesets?targets=tag&includes_parents=true'
  const ruleset = settings['repos/o/r/rulesets/1']
  assert.equal((await auditRemote({ overrides: { [list]: [] } }))['GH-02'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { [list]: [{ id: 1, target: 'tag', enforcement: 'evaluate' }] } }))['GH-02'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/rulesets/1': { ...ruleset, rules: [{ type: 'deletion' }] } } }))['GH-02'].status, 'fail')
  // Every release tag prefix must be covered, such as a second package's `mcp-v*`, on any page.
  const tags = {
    'repos/o/r/tags?per_page=100&page=1': Array.from({ length: 100 }, (_, i) => ({ name: `v1.0.${i}` })),
    'repos/o/r/tags?per_page=100&page=2': [{ name: 'mcp-v1.0.0' }, { name: 'docs-snapshot' }],
  }
  const uncovered = (await auditRemote({ overrides: tags }))['GH-02']
  assert.equal(uncovered.status, 'fail')
  assert.match(uncovered.detail, /mcp-v1\.0\.0/)
  assert.doesNotMatch(uncovered.detail, /docs-snapshot/)
  const both = { ...ruleset, conditions: { ref_name: { include: ['refs/tags/v*', 'refs/tags/mcp-v*'], exclude: [] } } }
  assert.equal((await auditRemote({ overrides: { ...tags, 'repos/o/r/rulesets/1': both } }))['GH-02'].status, 'pass')
  // Tags that cannot be listed are unverified, not covered.
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/tags?per_page=100&page=1': undefined } }))['GH-02'].status, 'warn')
})

test('a tag ruleset with bypass actors does not protect release tags', async () => {
  const ruleset = settings['repos/o/r/rulesets/1']
  const bypass = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]
  const result = (await auditRemote({ overrides: { 'repos/o/r/rulesets/1': { ...ruleset, bypass_actors: bypass } } }))['GH-02']
  assert.equal(result.status, 'fail')
  assert.match(result.detail, /release tags \(RepositoryRole 5, always\)/)
  // Without admin access GitHub omits bypass_actors, so the audit cannot pass the ruleset.
  const { bypass_actors: _, ...hidden } = ruleset
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/rulesets/1': hidden } }))['GH-02'].status, 'warn')
})

test('Actions token permissions', async () => {
  const path = 'repos/o/r/actions/permissions/workflow'
  assert.equal((await auditRemote({ overrides: { [path]: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: true } } }))['GH-04'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { [path]: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } } }))['GH-04'].status, 'fail')
  assert.equal((await auditRemote({ publishes: false, overrides: { [path]: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } } }))['GH-04'].status, 'pass')
  assert.equal((await auditRemote({ publishes: false }))['GH-04'].status, 'warn')
})

test('the npm environment has no admin bypass and deploys only from main', async () => {
  const env = settings['repos/o/r/environments/npm']
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm': { ...env, can_admins_bypass: true } } }))['GH-05'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm': { ...env, deployment_branch_policy: null } } }))['GH-05'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm': { ...env, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } } } }))['GH-05'].status, 'fail')
  const branches = { branch_policies: [{ name: 'main', type: 'branch' }, { name: 'release/*', type: 'branch' }] }
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm/deployment-branch-policies': branches } }))['GH-05'].status, 'fail')
})

test('secrets: npm fails, any other warns', async () => {
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm/secrets': { secrets: [{ name: 'NPM_TOKEN' }] } } }))['GH-07'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/actions/secrets': { secrets: [{ name: 'VERCEL_TOKEN' }] } } }))['GH-07'].status, 'warn')
})

test('Dependabot security updates warn', async () => {
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/automated-security-fixes': { enabled: true } } }))['GH-06'].status, 'warn')
})

test('provenance and dist-tags', async () => {
  const stale = { dist: {} }
  assert.equal((await auditRemote({ tags: { latest: { version: '1.0.0', ...stale } } }))['NPM-03'].status, 'warn')
  assert.equal((await auditRemote({ tags: { latest: provenance('1.2.0'), next: { version: '1.3.0-rc.0', ...stale } } }))['NPM-03'].status, 'warn')
  // latest older than the line next is heading to (an old beta left on latest)
  assert.equal((await auditRemote({ tags: { latest: provenance('0.8.0-beta.40'), next: provenance('1.0.0-rc.0') } }))['NPM-03'].status, 'warn')
  // next left behind after the stable release
  assert.equal((await auditRemote({ tags: { latest: provenance('1.0.0'), next: provenance('1.0.0-rc.3') } }))['NPM-05'].status, 'warn')
  // a minor prerelease on the same line is normal
  assert.equal((await auditRemote({ tags: { latest: provenance('1.1.0'), next: provenance('1.2.0-next.0') } }))['NPM-03'].status, 'pass')
  assert.equal((await auditRemote({ tags: { latest: provenance('0.9.0'), next: provenance('0.10.0-rc.0') } }))['NPM-03'].status, 'warn')
})

test('a failed registry lookup warns; a missing next tag does not', async () => {
  const registry = async (_name, tag) => {
    if (tag === 'latest') throw new Error('HTTP 503')
    return null
  }
  const result = (await auditRemote({ registry }))['NPM-03']
  assert.equal(result.status, 'warn')
  assert.match(result.detail, /could not verify latest \(HTTP 503\)/)
  assert.equal((await auditRemote({ tags: { latest: provenance('1.2.0') } }))['NPM-03'].status, 'pass')
})

test('compareVersions follows semver precedence', () => {
  const ordered = ['0.8.0-beta.40', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.0', '1.0.0', '1.0.1', '1.10.0']
  for (let i = 1; i < ordered.length; i++) assert.ok(compareVersions(ordered[i - 1], ordered[i]) < 0, `${ordered[i - 1]} < ${ordered[i]}`)
  assert.equal(compareVersions('1.0.0+build', '1.0.0'), 0)
})

test('required contributing and Claude files fail when missing', () => {
  for (const file of ['CONTRIBUTING.md', 'CLAUDE.md']) {
    assert.equal(audit({ [file]: null })['FILE-08'].status, 'fail', file)
  }
})

test('starter drift warns, accepts tokens and trailing whitespace, and records explanations', () => {
  const owned = ['.github/workflows/release.yml', '.github/workflows/preview.yml', 'scripts/release.mjs', 'scripts/lint-changesets.mjs', 'scripts/agent-docs.mjs']
  const files = Object.fromEntries(owned.map(file => [file, readFileSync(new URL(`../starters/_shared/library/${file}`, import.meta.url), 'utf8').replaceAll(/\{\{[A-Z_]+\}\}/g, 'example').split('\n').map(line => `${line}  `).join('\n')]))
  assert.equal(audit({ ...files, 'DECISIONS.md': '' })['FILE-10'].status, 'pass')
  for (const file of owned) {
    for (const content of [null, `${files[file]}\n# drift`]) {
      const result = audit({ ...files, [file]: content, 'DECISIONS.md': '' })['FILE-10']
      assert.equal(result.status, 'warn', file)
      assert.match(result.detail, new RegExp(file.replaceAll('.', '\\.')))
    }
    assert.equal(audit({ ...files, [file]: null, 'DECISIONS.md': `Keep ${file.split('/').at(-1)}.` })['FILE-10'].status, 'pass')
  }
})

test('each new remote auto check detects its failing or warning case', async () => {
  const old = '2026-08-01T00:00:00Z'
  const cases = [
    ['GH-03', 'fail', { overrides: { 'repos/o/r': { ...settings['repos/o/r'], allow_auto_merge: true } } }],
    ['GH-08', 'fail', { overrides: { 'repos/o/r/issues?state=open&per_page=100&page=1': [] } }],
    ['GH-08', 'warn', { overrides: { 'repos/o/r/issues?state=open&per_page=100&page=1': [{ title: 'Dependency Dashboard', updated_at: old }] } }],
    ['NPM-04', 'fail', { overrides: { 'repos/o/r/releases?per_page=100&page=1': [] } }],
    ['NPM-04', 'fail', { overrides: { 'repos/o/r/releases?per_page=100&page=1': [{ tag_name: 'v11.2.0' }] } }],
    // @lupinum/example: a prefix its name does not end with is another package's release.
    ['NPM-04', 'fail', { overrides: { 'repos/o/r/releases?per_page=100&page=1': [{ tag_name: 'other-v1.2.0' }] } }],
    ['NPM-04', 'pass', { overrides: { 'repos/o/r/releases?per_page=100&page=1': [{ tag_name: 'example-v1.2.0' }] } }],
    ['NPM-05', 'warn', { overrides: { 'repos/o/r/pulls?state=open&per_page=100&page=1': [{ number: 42, created_at: old, updated_at: old, head: { ref: 'changeset-release/main' } }] } }],
    ['DOC-01', 'fail', { fetch: async () => ({ ok: false, status: 503 }) }],
    ['DOC-02', 'fail', { fetch: async url => ({ ok: !url.endsWith('/llms.txt'), status: url.endsWith('/llms.txt') ? 404 : 200, text: async () => '# Docs' }) }],
    ...['<example', 'Component omitted', '<pm-install'].map(placeholder => ['DOC-02', 'fail', { fetch: async url => ({ ok: true, status: 200, text: async () => url.endsWith('/llms-full.txt') ? placeholder : '# Docs' }) }]),
    ['OPS-01', 'fail', { fleet: [] }],
    ['OPS-02', 'fail', { overrides: { 'repos/o/r/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=1': { workflow_runs: [{ conclusion: 'failure' }] } } }],
    ['OPS-03', 'fail', { overrides: { 'repos/o/r/dependabot/alerts?state=open&severity=high,critical&per_page=100': [{ security_advisory: { severity: 'high' } }, { security_advisory: { severity: 'critical' } }] } }],
    ['OPS-03', 'warn', { overrides: { 'repos/o/r/dependabot/alerts?state=open&severity=high,critical&per_page=100': undefined } }],
    // An advisory ignored in pnpm's auditConfig (no fix, recorded reason) is accepted there.
    ['OPS-03', 'pass', { workspace: 'auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\n', overrides: { 'repos/o/r/dependabot/alerts?state=open&severity=high,critical&per_page=100': [{ security_advisory: { severity: 'high', ghsa_id: 'GHSA-aaaa-bbbb-cccc' } }] } }],
    ['OPS-04', 'warn', { overrides: { 'repos/o/r/branches?per_page=100&page=1': [{ name: 'abandoned', commit: { sha: 'b' } }], 'repos/o/r/commits/b': { commit: { committer: { date: old } } } } }],
    ['OPS-05', 'warn', { overrides: { 'repos/o/r/pulls?state=open&per_page=100&page=1': [{ number: 42, updated_at: old, head: { ref: 'feature' } }] } }],
  ]
  for (const [id, expected, options] of cases) {
    const result = (await auditRemote(options))[id]
    assert.equal(result.status, expected, id)
    if (id === 'OPS-03' && expected === 'fail') assert.equal(result.detail, '2 open high or critical Dependabot alerts')
  }
})

test('DECISIONS exceptions apply by item ID, but no-exception safety checks still fail', () => {
  const decisions = 'FILE-07: approved alternative updater\n(FILE-03): approved unpinned action\nFILE-080 is not FILE-08 evidence'
  const result = audit({ 'DECISIONS.md': decisions, 'renovate.json': null, '.github/workflows/ci.yml': library['.github/workflows/ci.yml'].replace(sha, 'v4') })
  assert.equal(result['FILE-07'].status, 'pass')
  assert.equal(result['FILE-07'].detail, 'FILE-07: approved alternative updater')
  assert.equal(result['FILE-03'].status, 'fail')
  const items = checklistItems([{ id: 'FILE-08', status: 'fail', detail: 'missing' }], { files: [], read: () => 'FILE-080: different item' })
  assert.equal(items[0].status, 'fail')
})

test('manual and agent evidence belongs to the matching repository and item', async () => {
  const fleet = [{ repository: 'o/r', evidence: { 'NPM-01': '2026-10-03 trusted publisher checked' } }, { repository: 'other/repo', evidence: { 'NPM-02': 'checked elsewhere' } }]
  const result = await auditRemote({ fleet })
  assert.deepEqual(result['NPM-01'], { id: 'NPM-01', stage: 3, status: 'pass', check: 'manual', detail: '2026-10-03 trusted publisher checked' })
  assert.equal(result['NPM-02'].status, 'open')
  assert.equal(result['DOC-05'].status, 'open')
  assert.equal(result['DOC-05'].check, 'agent')
})

test('stage calculation stops at the first fail or open; warnings do not block', () => {
  for (const [items, maximum, expected] of [
    [[{ stage: 1, status: 'fail' }], 5, 0],
    [[{ stage: 1, status: 'warn' }, { stage: 3, status: 'open' }, { stage: 4, status: 'pass' }], 5, 2],
    [[{ stage: 4, status: 'fail' }, { stage: 5, status: 'pass' }], 5, 3],
    [[{ stage: 1, status: 'pass' }], 1, 1],
    [[{ stage: 1, status: 'pass' }, { stage: 5, status: 'warn' }], 5, 5],
  ]) assert.equal(stageReached(items, maximum), expected)
})

test('repositories publishing nothing omit every library-only item', async () => {
  const fileItems = Object.values(audit({ 'package.json': JSON.stringify({ private: true, scripts: { build: 'build', verify: 'pnpm audit' }, packageManager: 'pnpm@11.21.0' }) }))
  const remoteItems = Object.values(await auditRemote({ publishes: false }))
  assert.deepEqual([...fileItems, ...remoteItems].filter(item => ['FILE-04', 'FILE-05', 'FILE-10', 'FILE-11', 'GH-02', 'GH-05'].includes(item.id) || item.id.startsWith('NPM-')), [])
})
