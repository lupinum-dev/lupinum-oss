import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { auditFiles, auditSettings, compareVersions, localSource } from './audit.mjs'

const sha = 'a'.repeat(40)
const library = {
  'package.json': JSON.stringify({ name: '@lupinum/example', packageManager: 'pnpm@11.21.0', scripts: Object.fromEntries(['build', 'lint', 'typecheck', 'test', 'changeset'].map(s => [s, s]).concat([['verify', 'pnpm audit && pnpm test']])) }),
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
  ...Object.fromEntries(['README.md', 'LICENSE', 'SECURITY.md', 'AGENTS.md', 'DECISIONS.md'].map(f => [f, '#'])),
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
  assert.equal(audit({ '.github/workflows/release.yml': release.replace('environment: npm\n', '') })['publish-job'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': release.replace('--provenance ', '') })['publish-job'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': release.replace('      - uses: actions/download', '      - uses: actions/checkout@' + sha + '\n      - uses: actions/download') })['publish-job'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': `${release}        env: { NODE_AUTH_TOKEN: x }\n` })['no-npm-token'].status, 'fail')
  assert.equal(audit({ '.github/workflows/ci.yml': library['.github/workflows/ci.yml'].replace(sha, 'v4') })['actions-pinned'].status, 'fail')
  assert.equal(audit({ '.github/workflows/ci.yml': library['.github/workflows/ci.yml'].replace('contents: read', 'contents: write') }).permissions.status, 'fail')
  assert.equal(audit({ 'pnpm-workspace.yaml': 'minimumReleaseAge: 60\n' })['pnpm-quarantine'].status, 'fail')
  // A job that can push, open pull requests or start ci must not run dependency or repository code.
  const prJob = '    permissions: { contents: write, pull-requests: write }\n    steps:\n'
  for (const [permissions, run] of [
    ['{ contents: write, pull-requests: write, actions: write }', 'pnpm install --frozen-lockfile'],
    ['{ contents: write, pull-requests: write }', 'pnpm install --frozen-lockfile'],
    ['{ contents: write, pull-requests: write }', 'pnpm run version-packages'],
    ['{ contents: write }', 'node scripts/release.mjs tag'],
    ['write-all', 'npx changeset version'],
  ]) {
    assert.equal(audit({ '.github/workflows/release.yml': release.replace(prJob, `    permissions: ${permissions}\n    steps:\n      - run: ${run}\n`) }).permissions.status, 'fail', `${permissions} + ${run}`)
  }
})

test('pnpm audit through a CI matrix counts', () => {
  const ci = `on: pull_request\npermissions: { contents: read }\njobs:\n  check:\n    runs-on: ubuntu-24.04\n    strategy: { matrix: { task: [lint, audit] } }\n    steps:\n      - run: pnpm \${{ matrix.task }}\n  ci:\n    needs: check\n    runs-on: ubuntu-24.04\n    steps:\n      - run: 'true'\n`
  assert.equal(audit({ '.github/workflows/ci.yml': ci })['ci-audit'].status, 'pass')
  assert.equal(audit({ '.github/workflows/ci.yml': ci.replace('lint, audit', 'lint') })['ci-audit'].status, 'fail')
})

test('excess tooling warns', () => {
  const result = audit({ 'MAINTAINING.md': '#', '.github/workflows/extra.yml': 'on: push\npermissions: {}\njobs: {}\n' })
  assert.equal(result.lean.status, 'warn')
  assert.equal(result.workflows.status, 'warn')
})

test('an extra workflow named in DECISIONS.md passes', () => {
  const extra = { '.github/workflows/extra.yml': 'on: push\npermissions: {}\njobs: {}\n' }
  assert.equal(audit({ ...extra, 'DECISIONS.md': '- D2 (2026-09-27): Keep extra.yml — it runs a slow weekly check.' }).workflows.status, 'pass')
})

test('a publish dry run outside the npm environment passes; a real publish there fails', () => {
  const release = library['.github/workflows/release.yml']
  const pack = `  pack:\n    runs-on: ubuntu-24.04\n    permissions: { contents: read }\n    steps:\n      - uses: actions/checkout@${sha}\n      - run: npm publish ./package.tgz --dry-run --access public --ignore-scripts --tag next\n`
  assert.equal(audit({ '.github/workflows/release.yml': `${release}${pack}` })['publish-job'].status, 'pass')
  assert.equal(audit({ '.github/workflows/release.yml': `${release}${pack.replace(' --dry-run', '')}` })['publish-job'].status, 'fail')
})

test('the Changesets CLI runs without a write token', () => {
  const release = library['.github/workflows/release.yml']
  const readOnly = '    permissions: { contents: read, pull-requests: read }\n'
  assert.equal(audit({ '.github/workflows/release.yml': release.replace(readOnly, '    permissions: { contents: write, pull-requests: read }\n') })['version-job'].status, 'fail')
  assert.equal(audit({ '.github/workflows/release.yml': release.replace(readOnly, '    permissions: { contents: read, pull-requests: write }\n') })['version-job'].status, 'fail')
  const action = release.replace('      - run: pnpm exec changeset version\n', `      - uses: changesets/action@${sha}\n`).replace(readOnly, '    permissions: { contents: write, pull-requests: write }\n')
  assert.equal(audit({ '.github/workflows/release.yml': action })['version-job'].status, 'fail')
  // changelog-github is the starter default, not a requirement.
  assert.equal(audit({ '.changeset/config.json': '{ "changelog": "@changesets/cli/changelog" }' }).changesets.status, 'pass')
})

// ---------- settings ----------

const settings = {
  'repos/o/r/rules/branches/main': [
    { type: 'pull_request', parameters: { required_approving_review_count: 0, allowed_merge_methods: ['squash'] } },
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci', integration_id: 15368 }] } },
    { type: 'non_fast_forward' },
    { type: 'required_linear_history' },
  ],
  'repos/o/r/rulesets?targets=tag&includes_parents=true': [{ id: 1, target: 'tag', enforcement: 'active' }],
  'repos/o/r/rulesets/1': { conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } }, rules: [{ type: 'update' }, { type: 'deletion' }] },
  'repos/o/r/releases?per_page=100': [{ tag_name: 'v1.2.0' }],
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

async function auditRemote({ overrides = {}, meta = {}, publishes = true, tags = { latest: provenance('1.2.0') } } = {}) {
  const responses = { ...settings, ...overrides }
  const api = path => (responses[path] === undefined ? { ok: false, notFound: true, error: 'HTTP 404' } : { ok: true, data: responses[path] })
  const src = {
    repository: 'o/r',
    branch: 'main',
    meta: { allow_auto_merge: false, security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } }, ...meta },
    files: ['package.json'],
    read: path => (path === 'package.json' ? JSON.stringify({ name: '@lupinum/example' }) : null),
  }
  const results = await auditSettings(src, { publishes, api, registry: async (_name, tag) => tags[tag] ?? null })
  return Object.fromEntries(results.map(r => [r.id, r]))
}

test('standard settings pass', async () => {
  assert.deepEqual(Object.values(await auditRemote()).filter(r => r.status !== 'pass'), [])
})

test('the required ci check must come from GitHub Actions', async () => {
  const rules = settings['repos/o/r/rules/branches/main'].map(rule => rule.type === 'required_status_checks'
    ? { ...rule, parameters: { required_status_checks: [{ context: 'ci' }] } }
    : rule)
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/rules/branches/main': rules } })).ruleset.status, 'fail')
  assert.equal((await auditRemote({ meta: { allow_auto_merge: true } })).ruleset.status, 'fail')
})

test('release tags cannot be moved or deleted', async () => {
  const list = 'repos/o/r/rulesets?targets=tag&includes_parents=true'
  const ruleset = settings['repos/o/r/rulesets/1']
  assert.equal((await auditRemote({ overrides: { [list]: [] } }))['tag-ruleset'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { [list]: [{ id: 1, target: 'tag', enforcement: 'evaluate' }] } }))['tag-ruleset'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/rulesets/1': { ...ruleset, rules: [{ type: 'deletion' }] } } }))['tag-ruleset'].status, 'fail')
  // Every released tag prefix must be covered, such as a second package's `mcp-v*`.
  const releases = { 'repos/o/r/releases?per_page=100': [{ tag_name: 'v1.2.0' }, { tag_name: 'mcp-v1.0.0' }] }
  assert.equal((await auditRemote({ overrides: releases }))['tag-ruleset'].status, 'fail')
  const both = { ...ruleset, conditions: { ref_name: { include: ['refs/tags/v*', 'refs/tags/mcp-v*'], exclude: [] } } }
  assert.equal((await auditRemote({ overrides: { ...releases, 'repos/o/r/rulesets/1': both } }))['tag-ruleset'].status, 'pass')
})

test('Actions token permissions', async () => {
  const path = 'repos/o/r/actions/permissions/workflow'
  assert.equal((await auditRemote({ overrides: { [path]: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: true } } }))['actions-permissions'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { [path]: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } } }))['actions-permissions'].status, 'fail')
  assert.equal((await auditRemote({ publishes: false, overrides: { [path]: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } } }))['actions-permissions'].status, 'pass')
  assert.equal((await auditRemote({ publishes: false }))['actions-permissions'].status, 'warn')
})

test('the npm environment has no admin bypass and deploys only from main', async () => {
  const env = settings['repos/o/r/environments/npm']
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm': { ...env, can_admins_bypass: true } } }))['npm-environment'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm': { ...env, deployment_branch_policy: null } } }))['npm-environment'].status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm': { ...env, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } } } }))['npm-environment'].status, 'fail')
  const branches = { branch_policies: [{ name: 'main', type: 'branch' }, { name: 'release/*', type: 'branch' }] }
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm/deployment-branch-policies': branches } }))['npm-environment'].status, 'fail')
})

test('secrets: npm fails, any other warns', async () => {
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/environments/npm/secrets': { secrets: [{ name: 'NPM_TOKEN' }] } } })).secrets.status, 'fail')
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/actions/secrets': { secrets: [{ name: 'VERCEL_TOKEN' }] } } })).secrets.status, 'warn')
})

test('Dependabot security updates warn', async () => {
  assert.equal((await auditRemote({ overrides: { 'repos/o/r/automated-security-fixes': { enabled: true } } }))['dependabot-updates'].status, 'warn')
})

test('provenance and dist-tags', async () => {
  const stale = { dist: {} }
  assert.equal((await auditRemote({ tags: { latest: { version: '1.0.0', ...stale } } })).provenance.status, 'warn')
  assert.equal((await auditRemote({ tags: { latest: provenance('1.2.0'), next: { version: '1.3.0-rc.0', ...stale } } })).provenance.status, 'warn')
  // latest older than the line next is heading to (an old beta left on latest)
  assert.equal((await auditRemote({ tags: { latest: provenance('0.8.0-beta.40'), next: provenance('1.0.0-rc.0') } })).provenance.status, 'warn')
  // next left behind after the stable release
  assert.equal((await auditRemote({ tags: { latest: provenance('1.0.0'), next: provenance('1.0.0-rc.3') } })).provenance.status, 'warn')
  // a minor prerelease on the same line is normal
  assert.equal((await auditRemote({ tags: { latest: provenance('1.1.0'), next: provenance('1.2.0-next.0') } })).provenance.status, 'pass')
  assert.equal((await auditRemote({ tags: { latest: provenance('0.9.0'), next: provenance('0.10.0-rc.0') } })).provenance.status, 'warn')
})

test('compareVersions follows semver precedence', () => {
  const ordered = ['0.8.0-beta.40', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.0', '1.0.0', '1.0.1', '1.10.0']
  for (let i = 1; i < ordered.length; i++) assert.ok(compareVersions(ordered[i - 1], ordered[i]) < 0, `${ordered[i - 1]} < ${ordered[i]}`)
  assert.equal(compareVersions('1.0.0+build', '1.0.0'), 0)
})
