import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { auditFiles, localSource } from './audit.mjs'

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
  version:
    runs-on: ubuntu-24.04
    permissions: { contents: write, pull-requests: write }
    steps:
      - uses: changesets/action@${sha}
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
  // The job that runs the Changesets CLI must not be able to start ci for its own commits.
  const versionJob = '    permissions: { contents: write, pull-requests: write }\n    steps:\n'
  assert.equal(audit({ '.github/workflows/release.yml': release.replace(versionJob, '    permissions: { contents: write, pull-requests: write, actions: write }\n    steps:\n      - run: pnpm install --frozen-lockfile\n') }).permissions.status, 'fail')
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
