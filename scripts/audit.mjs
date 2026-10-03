#!/usr/bin/env node
// Read-only audit of Lupinum repositories against https://oss.lupinum.com.
// It reports; it never changes files, settings, or registry state.
//
//   node scripts/audit.mjs                   every repository in fleet/libraries.json
//   node scripts/audit.mjs owner/repo ...    named repositories (files + settings through `gh api`)
//   node scripts/audit.mjs --local <dir>     files in a local checkout only
//   add --json for machine-readable output
//
// Exit code 1 means at least one FAIL. WARN marks excess tooling or something
// the audit could not read; read the detail before acting on it.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'

const LIMITS = { scripts: 20, scriptLines: 1500 }
const SKIP_DIRS = new Set(['node_modules', '.git', '.nuxt', '.output', '.vercel', '.data', 'dist', 'coverage', '.turbo', '.cache'])
const GOVERNANCE = /(^|\/)(MAINTAINING|RELEASING|GOVERNANCE)\.md$|(ledger|certif|reconcil|release-(audit|policy|manifest|card|state))/i

// ---------- sources ----------

export function localSource(dir) {
  const root = resolve(dir)
  // In a Git checkout, audit what Git would track (ignored folders such as agent worktrees are skipped).
  const tracked = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
  const files = tracked.status === 0 ? tracked.stdout.split('\n').filter(file => file && existsSync(join(root, file))) : []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else files.push(relative(root, path).split(sep).join('/'))
    }
  }
  if (tracked.status !== 0) walk(root)
  return { label: root, files, read: path => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null) }
}

function gh(path, { raw = false } = {}) {
  const args = ['api', ...(raw ? ['-H', 'Accept: application/vnd.github.raw'] : []), path]
  try {
    const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })
    return { ok: true, data: raw ? out : out.trim() ? JSON.parse(out) : null }
  }
  catch (error) {
    const message = String(error.stderr || error.message).trim().split('\n').at(-1)
    return { ok: false, error: message, notFound: /HTTP 404/.test(message) }
  }
}

export function remoteSource(repository) {
  const meta = gh(`repos/${repository}`)
  if (!meta.ok) throw new Error(`${repository}: ${meta.error}`)
  const branch = meta.data.default_branch
  const tree = gh(`repos/${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
  if (!tree.ok) throw new Error(`${repository}: ${tree.error}`)
  const files = tree.data.tree.filter(entry => entry.type === 'blob').map(entry => entry.path)
  const known = new Set(files)
  const cache = new Map()
  const read = (path) => {
    if (!known.has(path)) return null
    if (!cache.has(path)) {
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      const result = gh(`repos/${repository}/contents/${encoded}?ref=${encodeURIComponent(branch)}`, { raw: true })
      cache.set(path, result.ok ? result.data : null)
    }
    return cache.get(path)
  }
  return { label: `${repository} (${branch})`, repository, branch, meta: meta.data, truncated: tree.data.truncated, files, read }
}

// ---------- helpers ----------

const safe = fn => { try { return fn() } catch { return undefined } }
const json = text => (text == null ? undefined : safe(() => JSON.parse(text)))
const yaml = text => (text == null ? undefined : safe(() => parseYaml(text)))
const list = items => items.join(', ')

function triggers(workflow) {
  const on = workflow?.on
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on
  return Object.keys(on ?? {})
}

function steps(job) {
  return Array.isArray(job?.steps) ? job.steps : []
}

// Installs or runs dependency or repository code: a package manager or JavaScript runtime, a
// script interpreter or make, a file run by path, by a shell or with `source`/`.`, or a local action.
const COMMAND = String.raw`(?:^|[;&|(\`{])[ \t]*(?:(?:sudo|exec|env|time|then|do|else|if|!)[ \t]+|\w+=\S*[ \t]+)*`
const RUNS_CODE = [
  /(^|[\s;&|(`])(pnpm|yarn|npx|bun|bunx|node|tsx|deno)(\s|$)|\bnpm\s+(install|i|ci|add|run|exec|x|test|start|rebuild|pack)\b/m,
  new RegExp(`${COMMAND}(?:python[\\d.]*|ruby|perl|php|make)(?:\\s|$)`, 'm'),
  new RegExp(`${COMMAND}(?:bash|sh|zsh|dash|ksh)(?:[ \\t]+-[a-bd-zA-Z]+)*[ \\t]+[^\\s;&|<>-]`, 'm'), // a file, not -c or stdin
  new RegExp(`${COMMAND}(?:source|\\.)[ \\t]+["']?[^\\s;&|"']*(?:/|\\.sh\\b)`, 'm'),
  new RegExp(`${COMMAND}["']?\\.{1,2}/`, 'm'),
]
const runsCode = step => RUNS_CODE.some(pattern => pattern.test(typeof step?.run === 'string' ? step.run : '')) || /^\.\//.test(step?.uses ?? '')

export function publicPackages(src) {
  return publicManifests(src).map(({ manifest }) => manifest.name)
}

// Public workspace packages with the directory they live in ('' for the root).
function publicManifests(src) {
  const manifests = ['package.json']
  const patterns = yaml(src.read('pnpm-workspace.yaml'))?.packages ?? []
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) continue
    const recursive = pattern.endsWith('/**')
    const base = pattern.replace(/\/\*\*?$/, '')
    const wildcard = base !== pattern
    for (const file of src.files) {
      if (!file.endsWith('/package.json')) continue
      const dir = file.slice(0, -'/package.json'.length)
      const rest = dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : null
      if (wildcard ? rest && (recursive || !rest.includes('/')) : dir === base) manifests.push(file)
    }
  }
  return manifests
    .map(file => ({ dir: file.slice(0, -'package.json'.length), manifest: json(src.read(file)) }))
    .filter(({ manifest }) => manifest?.name && !manifest.private)
}

// Checklist metadata is shared by aggregation, evidence and both output formats.
const STAGES = ['Not reached', 'Built', 'Protected', 'Released', 'Documented', 'Maintained']
const LIBRARY_ONLY = new Set(['FILE-04', 'FILE-05', 'FILE-10', 'FILE-11', 'GH-02', 'GH-05', 'NPM-01', 'NPM-02', 'NPM-03', 'NPM-04', 'NPM-05'])
const NO_EXCEPTION = new Set(['FILE-03', 'FILE-04', 'FILE-06', 'GH-01', 'GH-02', 'GH-05'])
const EVIDENCE_CHECKS = { 'NPM-01': 'manual', 'NPM-02': 'manual', 'DOC-03': 'agent', 'DOC-04': 'agent', 'DOC-05': 'agent' }
const ITEM_IDS = [
  ...Array.from({ length: 11 }, (_, i) => `FILE-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `GH-${String(i + 1).padStart(2, '0')}`),
  ...['NPM', 'DOC', 'OPS'].flatMap(prefix => Array.from({ length: 5 }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`)),
]
const CHECK_ITEMS = {
  workflows: 'FILE-01', preview: 'FILE-01', 'ci-check': 'FILE-02', 'ci-audit': 'FILE-02',
  'actions-pinned': 'FILE-03', permissions: 'FILE-03', 'pull-request-target': 'FILE-03',
  'publish-job': 'FILE-04', 'no-npm-token': 'FILE-04', changesets: 'FILE-05', 'version-job': 'FILE-05',
  'pnpm-quarantine': 'FILE-06', renovate: 'FILE-07', files: 'FILE-08', lean: 'FILE-08',
  scripts: 'FILE-09', 'agent-docs': 'FILE-11', ruleset: 'GH-01', 'tag-ruleset': 'GH-02',
  'actions-permissions': 'GH-04', 'npm-environment': 'GH-05', 'secret-scanning': 'GH-06',
  codeql: 'GH-06', 'dependabot-updates': 'GH-06', secrets: 'GH-07', provenance: 'NPM-03',
  vercel: 'DOC-01', tree: 'FILE-01',
}
const itemStage = id => ({ FILE: 1, GH: 2, NPM: 3, DOC: 4, OPS: 5 })[id.split('-')[0]]
const SEVERITY = { pass: 0, warn: 1, open: 2, fail: 3 }

export function checklistItems(results, src, { publishes = publicPackages(src).length > 0 } = {}) {
  const items = new Map()
  for (const result of results) {
    const id = CHECK_ITEMS[result.id] ?? result.id
    if (!publishes && LIBRARY_ONLY.has(id)) continue
    const previous = items.get(id)
    items.set(id, {
      id, stage: itemStage(id), check: EVIDENCE_CHECKS[id] ?? 'auto',
      status: previous && SEVERITY[previous.status] > SEVERITY[result.status] ? previous.status : result.status,
      detail: previous ? `${previous.detail}; ${result.detail}` : result.detail,
    })
  }
  const decisions = (src.read('DECISIONS.md') ?? '').split('\n')
  for (const item of items.values()) {
    const exception = decisions.find(line => new RegExp(`\\b${item.id}\\b`).test(line))
    if (exception && !NO_EXCEPTION.has(item.id) && ['fail', 'warn'].includes(item.status)) {
      item.status = 'pass'
      item.detail = exception.trim()
    }
  }
  return [...items.values()].sort((a, b) => ITEM_IDS.indexOf(a.id) - ITEM_IDS.indexOf(b.id))
}

export function stageReached(items, maximum = 5) {
  let reached = 0
  for (let stage = 1; stage <= maximum; stage++) {
    if (items.some(item => item.stage === stage && !['pass', 'warn'].includes(item.status))) break
    reached = stage
  }
  return reached
}

function readFleet() {
  return JSON.parse(readFileSync(new URL('../fleet/libraries.json', import.meta.url), 'utf8')).repositories
}

const OWNED_FILES = ['.github/workflows/release.yml', '.github/workflows/preview.yml', 'scripts/release.mjs', 'scripts/lint-changesets.mjs', 'scripts/agent-docs.mjs']
// Tokens stand for a segment within one line; whitespace at line ends is immaterial.
function matchesStarter(actual, template) {
  const normalize = text => text.split('\n').map(line => line.trimEnd()).join('\n')
  const pattern = normalize(template).split(/(\{\{[A-Z_]+\}\})/).map(part => /^\{\{[A-Z_]+\}\}$/.test(part)
    ? '[^\\n]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
  return actual !== null && new RegExp(`^${pattern}$`).test(normalize(actual))
}

// ---------- file checks (local and remote) ----------

export function auditFiles(src, { publishes = publicPackages(src).length > 0 } = {}) {
  const results = []
  const add = (id, status, detail) => results.push({ id, status, detail })
  const workflowFiles = src.files.filter(file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file))
  const workflows = new Map(workflowFiles.map(file => [file.slice('.github/workflows/'.length), { text: src.read(file) ?? '', data: yaml(src.read(file)) }]))
  const pkg = json(src.read('package.json'))

  // 1. The three workflows, nothing else.
  const expected = publishes ? ['ci.yml', 'release.yml', 'preview.yml'] : ['ci.yml']
  const missing = expected.filter(name => !workflows.has(name))
  const extra = [...workflows.keys()].filter(name => !expected.includes(name))
  // An extra workflow is fine when DECISIONS.md names it and says why.
  const decisions = src.read('DECISIONS.md') ?? ''
  const unexplained = extra.filter(name => !decisions.includes(name))
  if (missing.length) add('workflows', 'fail', `missing ${list(missing)}`)
  else if (unexplained.length) add('workflows', 'warn', `extra workflows: ${list(unexplained)} (standard is ${list(expected)}; record a reason in DECISIONS.md or remove)`)
  else add('workflows', 'pass', `${list(expected)}${extra.length ? `; ${list(extra)} explained in DECISIONS.md` : ''}`)

  // 2. ci.yml produces the required `ci` check and runs the dependency audit.
  const ci = workflows.get('ci.yml')
  if (ci) {
    const hasCiJob = Object.entries(ci.data?.jobs ?? {}).some(([id, job]) => (job?.name ?? id) === 'ci')
    add('ci-check', hasCiJob ? 'pass' : 'fail', hasCiJob ? "job 'ci' exists" : "no job named 'ci' (the ruleset requires this check)")
    // Directly, through a matrix value (`pnpm ${{ matrix.task }}`), or through a package script CI calls.
    const commands = Object.values(ci.data?.jobs ?? {}).flatMap(job => steps(job).flatMap((step) => {
      const run = typeof step?.run === 'string' ? step.run : ''
      const key = run.match(/\$\{\{\s*matrix\.(\w+)\s*\}\}/)?.[1]
      const values = key ? job.strategy?.matrix?.[key] : undefined
      return Array.isArray(values) ? values.map(value => run.replaceAll(new RegExp(`\\$\\{\\{\\s*matrix\\.${key}\\s*\\}\\}`, 'g'), value)) : [run]
    })).join('\n')
    const calls = name => new RegExp(`pnpm (run )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(commands)
    const audits = /\bpnpm audit\b/.test(commands)
      || Object.entries(pkg?.scripts ?? {}).some(([name, command]) => /\bpnpm audit\b/.test(command) && calls(name))
    add('ci-audit', audits ? 'pass' : 'fail', audits ? 'pnpm audit runs in CI' : 'CI does not run pnpm audit')
  }

  if (!ci) add('ci-check', 'fail', 'ci.yml missing; CI checks unverified')

  // 3. Actions pinned by full commit SHA.
  const unpinned = []
  for (const [name, { data }] of workflows) {
    for (const job of Object.values(data?.jobs ?? {})) {
      for (const uses of [job?.uses, ...steps(job).map(step => step?.uses)]) {
        if (typeof uses !== 'string' || uses.startsWith('./') || uses.startsWith('docker://')) continue
        if (!/@[0-9a-f]{40}$/.test(uses)) unpinned.push(`${name}: ${uses}`)
      }
    }
  }
  add('actions-pinned', unpinned.length ? 'fail' : 'pass', unpinned.length ? list(unpinned) : 'every action uses a full SHA')

  // 4. Minimal permissions: read-only default, write granted per job.
  const permissionProblems = []
  for (const [name, { data, text }] of workflows) {
    if (/write-all/.test(text)) permissionProblems.push(`${name}: write-all`)
    const top = data?.permissions
    const jobs = Object.entries(data?.jobs ?? {})
    if (top === undefined) {
      const bare = jobs.filter(([, job]) => job?.permissions === undefined).map(([id]) => id)
      if (bare.length) permissionProblems.push(`${name}: no top-level permissions and jobs without permissions (${list(bare)})`)
    }
    else if (typeof top === 'object' && top && Object.values(top).includes('write')) {
      permissionProblems.push(`${name}: top-level permissions grant write; grant it per job`)
    }
    // A job that can push, open pull requests or start workflows (and so a green `ci`) must not
    // run dependency or repository code.
    for (const [id, job] of jobs) {
      const permissions = job?.permissions ?? top
      const writes = permissions === 'write-all' ? ['write-all'] : ['actions', 'contents', 'pull-requests'].filter(scope => permissions?.[scope] === 'write').map(scope => `${scope}: write`)
      if (writes.length && steps(job).some(runsCode)) permissionProblems.push(`${name}: job ${id} installs or runs repository code and has ${list(writes)}`)
    }
  }
  add('permissions', permissionProblems.length ? 'fail' : 'pass', permissionProblems.length ? list(permissionProblems) : 'read-only default, write per job')

  // 5. No pull_request_target with secrets; no npm tokens anywhere.
  const prt = [...workflows].filter(([, { data }]) => triggers(data).includes('pull_request_target'))
  const prtWithSecrets = prt.filter(([, { text }]) => /secrets\.(?!GITHUB_TOKEN)/.test(text)).map(([name]) => name)
  if (prtWithSecrets.length) add('pull-request-target', 'fail', `pull_request_target with secrets: ${list(prtWithSecrets)}`)
  else if (prt.length) add('pull-request-target', 'warn', `pull_request_target used: ${list(prt.map(([name]) => name))}`)
  else add('pull-request-target', 'pass', 'not used')

  const tokenHits = [...workflows].filter(([, { text }]) => /NPM_TOKEN|NODE_AUTH_TOKEN/.test(text)).map(([name]) => name)
  if (/_authToken/.test(src.read('.npmrc') ?? '')) tokenHits.push('.npmrc')
  add('no-npm-token', tokenHits.length ? 'fail' : 'pass', tokenHits.length ? `npm token referenced in ${list(tokenHits)}` : 'no npm token references')

  // 6. Publish job: protected environment, OIDC, exact tarball, no checkout or install.
  if (publishes) {
    const release = workflows.get('release.yml')
    const problems = []
    // A `--dry-run` rehearsal publishes nothing, so only real publish lines count.
    const realPublish = run => run.split('\n').some(line => /\bnpm publish\b/.test(line) && !/--dry-run\b/.test(line))
    const publishJobs = Object.entries(release?.data?.jobs ?? {}).filter(([, job]) => steps(job).some(step => realPublish(step?.run ?? '')))
    if (!release) problems.push('release.yml missing')
    else if (!publishJobs.length) problems.push('no job in release.yml runs npm publish')
    for (const [id, job] of publishJobs) {
      const environment = typeof job.environment === 'string' ? job.environment : job.environment?.name
      if (environment !== 'npm') problems.push(`${id}: not in the 'npm' environment`)
      if (job.permissions?.['id-token'] !== 'write') problems.push(`${id}: missing id-token: write`)
      for (const step of steps(job)) {
        if (/actions\/checkout@/.test(step?.uses ?? '')) problems.push(`${id}: checks out the repository`)
        const run = step?.run ?? ''
        if (/\b(pnpm|npm|yarn)\s+(install|i|ci|add|run|exec|dlx)\b|\bnpx\b/.test(run)) problems.push(`${id}: installs or runs repository code`)
        if (realPublish(run)) {
          for (const flag of ['--provenance', '--ignore-scripts', '--access public']) if (!run.includes(flag)) problems.push(`${id}: npm publish without ${flag}`)
        }
      }
    }
    add('publish-job', problems.length ? 'fail' : 'pass', problems.length ? list([...new Set(problems)]) : "npm publish of packed tarball in 'npm' environment with OIDC")

    const changesets = json(src.read('.changeset/config.json'))
    if (!changesets) add('changesets', 'fail', '.changeset/config.json missing or invalid')
    else add('changesets', 'pass', `.changeset/config.json, changelog ${JSON.stringify(changesets.changelog ?? 'default')}`)

    // The Changesets CLI is dependency code: the job that runs it gets a read-only token and
    // only produces a patch; a job that runs no repository code pushes it and opens the PR.
    const versionJobs = Object.entries(release?.data?.jobs ?? {})
      .filter(([, job]) => steps(job).some(step => /changesets\/action@/.test(step?.uses ?? '') || /\bchangeset version\b/.test(step?.run ?? '')))
    const writers = versionJobs.filter(([, job]) => {
      const permissions = job?.permissions ?? release.data.permissions
      return permissions === 'write-all' || ['contents', 'pull-requests'].some(scope => permissions?.[scope] === 'write')
    }).map(([id]) => id)
    if (!versionJobs.length) add('version-job', 'warn', 'no job in release.yml runs changeset version')
    else if (writers.length) add('version-job', 'fail', `${list(writers)} runs the Changesets CLI with contents or pull-requests write; run it read-only and push its patch from a job that runs no repository code`)
    else add('version-job', 'pass', `${list(versionJobs.map(([id]) => id))} runs the Changesets CLI read-only`)

    // Agents in consuming projects read the docs of the installed version through the
    // `./agent-docs` export; the README they see (the package's own) says how to point at it.
    // `files` entries are matched on directory boundaries (`dist`, `dist/`, `dist/**`); a glob or
    // negation inside an entry is beyond this check, which then reports the export as not shipped.
    const agentProblems = []
    for (const { dir, manifest } of publicManifests(src)) {
      const target = manifest.exports?.['./agent-docs']?.replace?.(/^\.\//, '')
      const covers = entry => typeof entry === 'string' && (path => target === path || target.startsWith(`${path}/`))(entry.replace(/^\.\//, '').replace(/\/(\*\*)?$/, ''))
      if (!target || (manifest.files && !manifest.files.some(covers))) agentProblems.push(`${manifest.name}: no shipped './agent-docs' export`)
      const readme = src.read(`${dir}README.md`) ?? ''
      if (!/^## Agent setup$/m.test(readme) || !readme.includes(`node_modules/${manifest.name}/dist/agent/AGENTS.md`)) agentProblems.push(`${manifest.name}: ${dir}README.md has no agent setup section for it`)
    }
    add('agent-docs', agentProblems.length ? 'fail' : 'pass', agentProblems.length ? list(agentProblems) : "'./agent-docs' export and README agent setup")

    const preview = workflows.get('preview.yml')?.text ?? ''
    add('preview', /pkg-pr-new|pkg\.pr\.new/.test(preview) ? 'pass' : 'warn', /pkg-pr-new|pkg\.pr\.new/.test(preview) ? 'pkg.pr.new' : 'preview.yml does not use pkg.pr.new')
  }

  // 7. Renovate with a release-age delay; one update bot.
  const renovateFile = ['renovate.json', 'renovate.json5', '.github/renovate.json', '.github/renovate.json5', '.renovaterc', '.renovaterc.json'].find(file => src.files.includes(file))
  const renovate = renovateFile ? src.read(renovateFile) ?? '' : ''
  if (!renovateFile) add('renovate', 'fail', 'no Renovate config')
  else if (!/minimumReleaseAge/.test(renovate)) add('renovate', 'fail', `${renovateFile} has no minimumReleaseAge`)
  else if (src.files.includes('.github/dependabot.yml')) add('renovate', 'warn', 'dependabot.yml also opens update PRs; keep Renovate only')
  else add('renovate', 'pass', renovateFile)

  // 8. pnpm quarantine and build-script allowlist.
  const workspace = yaml(src.read('pnpm-workspace.yaml')) ?? {}
  const quarantineProblems = []
  if (!String(pkg?.packageManager ?? '').startsWith('pnpm@')) quarantineProblems.push('packageManager is not pinned to pnpm')
  if (!(Number(workspace.minimumReleaseAge) >= 1440)) quarantineProblems.push(`minimumReleaseAge is ${workspace.minimumReleaseAge ?? 'unset'} (need >= 1440)`)
  if (workspace.dangerouslyAllowAllBuilds === true) quarantineProblems.push('dangerouslyAllowAllBuilds is true')
  const excluded = workspace.minimumReleaseAgeExclude ?? []
  if (quarantineProblems.length) add('pnpm-quarantine', 'fail', list(quarantineProblems))
  else if (excluded.length) add('pnpm-quarantine', 'warn', `quarantine exclusions present: ${list(excluded)}`)
  else add('pnpm-quarantine', 'pass', `minimumReleaseAge ${workspace.minimumReleaseAge}`)

  // 9. Required scripts.
  const scripts = Object.keys(pkg?.scripts ?? {})
  const requiredScripts = publishes ? ['build', 'lint', 'typecheck', 'test', 'verify', 'changeset'] : ['build', 'verify']
  const missingScripts = requiredScripts.filter(name => !scripts.includes(name))
  add('scripts', missingScripts.length ? 'fail' : 'pass', missingScripts.length ? `missing ${list(missingScripts)}` : list(requiredScripts))

  // 10. Repository files.
  const requiredFiles = ['README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md', 'DECISIONS.md']
  const missingFiles = requiredFiles.filter(file => !src.files.includes(file))
  add('files', missingFiles.length ? 'fail' : 'pass', missingFiles.length ? `missing ${list(missingFiles)}` : list(requiredFiles))

  // 11. Docs deploy through Vercel Git integration with an ignore command.
  if (src.files.some(file => file.startsWith('docs/'))) {
    const vercel = json(src.read('docs/vercel.json') ?? src.read('vercel.json'))
    add('vercel', vercel?.ignoreCommand ? 'pass' : 'warn', vercel?.ignoreCommand ? `ignoreCommand: ${vercel.ignoreCommand}` : 'docs exist but vercel.json has no ignoreCommand')
  }

  // 12. Excess tooling.
  const excess = []
  if (scripts.length > LIMITS.scripts) excess.push(`${scripts.length} package scripts (> ${LIMITS.scripts})`)
  const scriptLines = src.files.filter(file => file.startsWith('scripts/')).reduce((sum, file) => sum + (src.read(file) ?? '').split('\n').length, 0)
  if (scriptLines > LIMITS.scriptLines) excess.push(`${scriptLines} lines in scripts/ (> ${LIMITS.scriptLines})`)
  const governance = src.files.filter(file => (!file.includes('/') || /^(scripts|\.github)\//.test(file)) && GOVERNANCE.test(file))
  if (governance.length) excess.push(`governance files: ${list(governance.slice(0, 8))}${governance.length > 8 ? ', ...' : ''}`)
  add('lean', excess.length ? 'warn' : 'pass', excess.length ? list(excess) : `${scripts.length} scripts, ${scriptLines} lines in scripts/`)

  if (publishes) {
    const different = OWNED_FILES.filter(file => !matchesStarter(src.read(file), readFileSync(new URL(`../starters/_shared/library/${file}`, import.meta.url), 'utf8')))
    const unexplained = different.filter(file => !decisions.includes(file.split('/').at(-1)))
    add('FILE-10', unexplained.length ? 'warn' : 'pass', unexplained.length
      ? `missing or different from starter: ${list(unexplained)}`
      : different.length ? `${list(different)} explained in DECISIONS.md` : 'standard-owned files match the starter')
  }
  return checklistItems(results, src, { publishes })
}

// ---------- settings checks (remote only) ----------

// Compares two semver versions: negative when a < b.
export function compareVersions(a, b) {
  const parse = version => {
    const [core, pre = ''] = String(version).replace(/\+.*$/, '').split(/-(.*)/s)
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }
  }
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i]
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]]
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1
    if (p === q) continue
    const [np, nq] = [/^\d+$/.test(p), /^\d+$/.test(q)]
    if (np && nq) return Number(p) - Number(q)
    if (np !== nq) return np ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

// The version manifest behind a dist-tag, or null when the tag does not exist. Throws when
// the registry cannot answer, so a failed lookup never reads as "no such tag".
async function registryTag(name, tag) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}${tag ? `/${tag}` : ''}`, { signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function auditSettings(src, { publishes = publicPackages(src).length > 0, api = gh, registry = registryTag, fetch: fetchUrl = globalThis.fetch, fleet = readFleet(), now = Date.now() } = {}) {
  const results = []
  const add = (id, status, detail) => results.push({ id, status, detail })
  const repo = src.repository
  if (src.truncated) add('tree', 'warn', 'git tree truncated; file checks may be incomplete')

  // 13. Ruleset on the default branch.
  const rules = api(`repos/${repo}/rules/branches/${encodeURIComponent(src.branch)}`)
  if (!rules.ok) add('ruleset', 'warn', `unverified: ${rules.error}`)
  else {
    const byType = type => rules.data.find(rule => rule.type === type)
    const problems = []
    if (!byType('pull_request')) problems.push('pull request not required')
    const checks = byType('required_status_checks')?.parameters?.required_status_checks ?? []
    const ci = checks.find(check => check.context === 'ci')
    if (!ci) problems.push(`required checks are [${list(checks.map(check => check.context))}], need 'ci'`)
    else if (ci.integration_id !== 15368) problems.push("required check 'ci' is not bound to GitHub Actions (integration_id 15368), so another app could report it")
    if (!byType('non_fast_forward')) problems.push('force push allowed')
    if (!byType('required_linear_history')) problems.push('linear history not required')
    const methods = byType('pull_request')?.parameters?.allowed_merge_methods
    const approvals = byType('pull_request')?.parameters?.required_approving_review_count ?? 0
    if (src.meta.allow_auto_merge && !approvals) problems.push('auto-merge enabled with no required approvals (any token that opens a PR could merge it)')
    if (problems.length) add('ruleset', 'fail', list(problems))
    else if (methods && (methods.length !== 1 || methods[0] !== 'squash')) add('ruleset', 'warn', `merge methods: ${list(methods)} (standard: squash)`)
    else add('ruleset', 'pass', `PR, 'ci' from GitHub Actions, no force push, linear history on ${src.branch}`)
  }

  // 13b. Release tags cannot be moved or deleted: an active tag ruleset without bypass actors
  // blocks update and deletion, and its patterns cover every release tag in the repository.
  if (publishes) {
    const listed = api(`repos/${repo}/rulesets?targets=tag&includes_parents=true`)
    if (!listed.ok) add('tag-ruleset', 'warn', `unverified: ${listed.error}`)
    else {
      const blocking = listed.data.filter(ruleset => ruleset.target === 'tag' && ruleset.enforcement === 'active')
        .map(ruleset => api(`repos/${repo}/rulesets/${ruleset.id}`)).filter(detail => detail.ok).map(detail => detail.data)
        .filter(ruleset => ['update', 'deletion'].every(type => ruleset.rules?.some(rule => rule.type === type)))
      // A bypass actor can still move or delete the tags, so such a ruleset protects nothing.
      const bypassed = blocking.filter(ruleset => ruleset.bypass_actors?.length)
        .map(ruleset => `${ruleset.name ?? ruleset.id} (${list(ruleset.bypass_actors.map(actor => `${actor.actor_type}${actor.actor_id ? ` ${actor.actor_id}` : ''}, ${actor.bypass_mode}`))})`)
      const rulesets = blocking.filter(ruleset => !ruleset.bypass_actors?.length)
      const toRegex = pattern => pattern === '~ALL' ? /^/ : new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*|\*/g, star => (star === '*' ? '[^/]*' : '.*'))}$`)
      const matches = (patterns, ref) => (patterns ?? []).some(pattern => toRegex(pattern).test(ref))
      const covered = ref => rulesets.some(({ conditions }) => matches(conditions?.ref_name?.include, ref) && !matches(conditions?.ref_name?.exclude, ref))
      // Every tag that ends in a version (v1.2.0, mcp-v1.0.0, @scope/pkg@1.2.0), across all pages.
      const tags = { ok: true, names: [] }
      for (let page = 1; tags.ok; page++) {
        const result = api(`repos/${repo}/tags?per_page=100&page=${page}`)
        if (!result.ok) Object.assign(tags, { ok: false, error: result.error })
        else tags.names.push(...result.data.map(tag => tag.name))
        if (!result.ok || result.data.length < 100) break
      }
      const uncovered = tags.names.filter(tag => /\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(tag) && !covered(`refs/tags/${tag}`))
      const patterns = rulesets.flatMap(({ conditions }) => conditions?.ref_name?.include ?? [])
      const bypass = bypassed.length ? `; ignored because of bypass actors: ${list(bypassed)}` : ''
      if (!rulesets.length) add('tag-ruleset', 'fail', `no active tag ruleset without bypass actors blocks update and deletion, so a release tag can be moved or deleted${bypass}`)
      else if (uncovered.length) add('tag-ruleset', 'fail', `release tags not covered by the tag ruleset: ${list(uncovered.slice(0, 5))}${uncovered.length > 5 ? ', ...' : ''}${bypass}`)
      else if (rulesets.some(ruleset => !Array.isArray(ruleset.bypass_actors))) add('tag-ruleset', 'warn', `${list(patterns)} block update and deletion; bypass actors unverified (needs admin access)`)
      else add('tag-ruleset', tags.ok ? 'pass' : 'warn', `${list(patterns)} cannot be moved or deleted${tags.ok ? '' : `; tags unverified: ${tags.error}`}`)
    }
  }

  // 14. Actions token: read-only by default; may open pull requests only where release.yml needs it.
  const workflow = api(`repos/${repo}/actions/permissions/workflow`)
  if (!workflow.ok) add('actions-permissions', 'warn', `unverified: ${workflow.error}`)
  else {
    const { default_workflow_permissions: token, can_approve_pull_request_reviews: canCreate } = workflow.data
    if (token !== 'read') add('actions-permissions', 'fail', `default GITHUB_TOKEN permissions are '${token}' (need 'read')`)
    else if (publishes && !canCreate) add('actions-permissions', 'fail', 'Actions may not create pull requests, so release.yml cannot open the Version packages PR')
    else if (!publishes && canCreate) add('actions-permissions', 'warn', 'Actions may create and approve pull requests, which a repository that publishes nothing does not need')
    else add('actions-permissions', 'pass', `read-only default${canCreate ? ', may create pull requests' : ''}`)
  }

  // 15. Protected npm environment: required reviewer, no admin bypass, deploys from main only.
  if (publishes) {
    const env = api(`repos/${repo}/environments/npm`)
    if (!env.ok) add('npm-environment', env.notFound ? 'fail' : 'warn', env.notFound ? "no 'npm' environment" : `unverified: ${env.error}`)
    else {
      const reviewers = env.data.protection_rules?.find(rule => rule.type === 'required_reviewers')?.reviewers ?? []
      const policy = env.data.deployment_branch_policy
      const branches = policy?.custom_branch_policies ? api(`repos/${repo}/environments/npm/deployment-branch-policies`) : null
      const onlyMain = branches?.ok && branches.data.branch_policies?.length === 1
        && branches.data.branch_policies[0].name === 'main' && (branches.data.branch_policies[0].type ?? 'branch') === 'branch'
      const problems = []
      if (!reviewers.length) problems.push('no required reviewer')
      if (env.data.can_admins_bypass !== false) problems.push('administrators can bypass the protection rules')
      if (!onlyMain) problems.push(branches && !branches.ok ? `deployment branches unverified: ${branches.error}` : "deployment branches are not exactly 'main'")
      if (problems.length) add('npm-environment', 'fail', list(problems))
      else add('npm-environment', 'pass', `reviewers: ${list(reviewers.map(r => r.reviewer?.login ?? r.reviewer?.name))}; main only; no admin bypass`)
    }
  }

  // 16. No secrets: the standard needs none, and an npm token must never exist.
  const secretNames = []
  let unreadable = false
  for (const path of [`repos/${repo}/actions/secrets`, ...(publishes ? [`repos/${repo}/environments/npm/secrets`] : [])]) {
    const secrets = api(path)
    if (secrets.ok) secretNames.push(...secrets.data.secrets.map(secret => secret.name))
    else if (!secrets.notFound) unreadable = true
  }
  const npmSecrets = secretNames.filter(name => /NPM/i.test(name))
  if (npmSecrets.length) add('secrets', 'fail', `npm secrets exist: ${list(npmSecrets)}`)
  else if (secretNames.length) add('secrets', 'warn', `Actions secrets exist: ${list(secretNames)} (the standard needs none; delete unused ones)`)
  else add('secrets', unreadable ? 'warn' : 'pass', unreadable ? 'unverified: secrets not readable' : 'no Actions secrets')

  // 17. Secret scanning, push protection, CodeQL default setup; Renovate alone opens update PRs.
  const security = src.meta.security_and_analysis
  if (!security) add('secret-scanning', 'warn', 'unverified: needs admin access')
  else {
    const off = ['secret_scanning', 'secret_scanning_push_protection'].filter(key => security[key]?.status !== 'enabled')
    add('secret-scanning', off.length ? 'fail' : 'pass', off.length ? `disabled: ${list(off)}` : 'secret scanning and push protection enabled')
  }
  const codeql = api(`repos/${repo}/code-scanning/default-setup`)
  if (!codeql.ok) add('codeql', 'warn', `unverified: ${codeql.error}`)
  else add('codeql', codeql.data.state === 'configured' ? 'pass' : 'fail', `default setup ${codeql.data.state}`)
  const fixes = api(`repos/${repo}/automated-security-fixes`)
  if (!fixes.ok) add('dependabot-updates', 'warn', `unverified: ${fixes.error}`)
  else add('dependabot-updates', fixes.data.enabled ? 'warn' : 'pass', fixes.data.enabled ? 'Dependabot security updates open pull requests next to Renovate; turn them off (alerts stay on)' : 'Dependabot security updates off')

  // 18. The versions behind `latest` and `next` carry provenance, and the tags are not stale.
  if (publishes) {
    const notes = []
    const waiting = []
    for (const name of publicPackages(src)) {
      const lookup = tag => Promise.resolve().then(() => registry(name, tag)).catch((error) => {
        notes.push(`${name}: could not verify ${tag} (${error.message})`)
        return null
      })
      const [latest, next] = await Promise.all([lookup('latest'), lookup('next')])
      for (const [tag, manifest] of [['latest', latest], ['next', next]]) {
        if (manifest && !manifest.dist?.attestations?.provenance) notes.push(`${name}@${manifest.version} (${tag}) has no provenance (fine only for a bootstrap version)`)
      }
      if (latest && next) {
        // A release line is what a caret range covers: one major, or one minor before 1.0.
        const [major, minor] = next.version.split('.').map(Number)
        const line = major > 0 ? `${major}.0.0` : `0.${minor}.0`
        if (compareVersions(latest.version, line) < 0) notes.push(`${name}: latest ${latest.version} is older than next's line ${line.replace(/(\.0)+$/, '.x')} (expected only while that line is in prerelease)`)
        else if (compareVersions(next.version, latest.version) < 0) waiting.push(`${name}: next ${next.version} is behind latest ${latest.version} (npm dist-tag rm ${name} next)`)
      }
    }
    add('provenance', notes.length ? 'warn' : 'pass', notes.length ? list(notes) : 'latest and next have provenance')
    add('NPM-05', waiting.length ? 'warn' : 'pass', waiting.length ? list(waiting) : 'dist-tags are current')
  }
  // Collection endpoints must include all pages: old PRs and dashboards can be beyond page one.
  const collection = (path) => {
    const data = []
    for (let page = 1; ; page++) {
      const result = api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      if (!result.ok) return result
      data.push(...result.data)
      if (result.data.length < 100) return { ok: true, data }
    }
  }
  const age = date => (now - Date.parse(date)) / 86_400_000
  const unverified = (id, result) => add(id, 'warn', `unverified: ${result.error ?? 'missing date'}`)

  const merges = api(`repos/${repo}`)
  if (!merges.ok) unverified('GH-03', merges)
  else {
    const expected = { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true, allow_auto_merge: false }
    const wrong = Object.entries(expected).filter(([key, value]) => merges.data[key] !== value).map(([key, value]) => `${key} must be ${value}`)
    add('GH-03', wrong.length ? 'fail' : 'pass', wrong.length ? list(wrong) : 'squash only, delete merged branches, auto-merge off')
  }
  for (const [path, label] of [['vulnerability-alerts', 'Dependabot alerts'], ['private-vulnerability-reporting', 'private vulnerability reporting']]) {
    const result = api(`repos/${repo}/${path}`)
    if (!result.ok) add('GH-06', result.notFound ? 'fail' : 'warn', result.notFound ? `${label} disabled` : `${label} unverified: ${result.error}`)
    else add('GH-06', result.data?.enabled === false ? 'fail' : 'pass', `${label} ${result.data?.enabled === false ? 'disabled' : 'enabled'}`)
  }
  const issues = collection(`repos/${repo}/issues?state=open`)
  if (!issues.ok) unverified('GH-08', issues)
  else {
    const dashboard = issues.data.filter(issue => !issue.pull_request && issue.title === 'Dependency Dashboard')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
    add('GH-08', !dashboard ? 'fail' : age(dashboard.updated_at) <= 14 ? 'pass' : 'warn',
      !dashboard ? 'no open Dependency Dashboard' : `Dependency Dashboard updated ${dashboard.updated_at}`)
  }

  const prs = collection(`repos/${repo}/pulls?state=open`)
  if (publishes) {
    if (!prs.ok) unverified('NPM-05', prs)
    else {
      const stale = prs.data.filter(pr => pr.head?.ref === 'changeset-release/main' && age(pr.created_at) > 14)
      add('NPM-05', stale.length ? 'warn' : 'pass', stale.length ? `Version packages PR older than 14 days: ${list(stale.map(pr => `#${pr.number}`))}` : 'no overdue Version packages PR')
    }
    const releases = collection(`repos/${repo}/releases`)
    const problems = []
    let unreadable = false
    let failed = false
    for (const name of publicPackages(src)) {
      try {
        const pack = await registry(name)
        if (!pack) { failed = true; problems.push(`${name}: no published versions`); continue }
        const newest = Object.keys(pack.versions ?? {}).filter(version => Number.isFinite(Date.parse(pack.time?.[version])))
          .sort((a, b) => Date.parse(pack.time[b]) - Date.parse(pack.time[a]))[0]
        if (!newest) { failed = true; problems.push(`${name}: no dated published version`) }
        else if (!releases.ok) { unreadable = true; problems.push(`${name}: releases unverified: ${releases.error}`) }
        else if (!releases.data.some(release => !release.draft && (release.tag_name === `v${newest}` || release.tag_name === `${name}@${newest}` || release.tag_name?.endsWith(newest)))) {
          failed = true
          problems.push(`${name}@${newest}: no GitHub release`)
        }
      }
      catch (error) { unreadable = true; problems.push(`${name}: registry unverified: ${error.message}`) }
    }
    add('NPM-04', failed ? 'fail' : unreadable ? 'warn' : 'pass', problems.length ? list(problems) : 'newest published versions have GitHub releases')
  }

  const homepage = json(src.read('package.json'))?.homepage
  if (!homepage) {
    add('DOC-01', 'warn', 'no homepage; URL check skipped')
    add('DOC-02', 'warn', 'no homepage; agent Markdown check skipped')
  }
  else {
    const get = async url => {
      try { return await fetchUrl(url, { signal: AbortSignal.timeout(15_000) }) }
      catch (error) { return { ok: false, status: error.message } }
    }
    const home = await get(homepage)
    add('DOC-01', home.ok ? 'pass' : 'fail', `${homepage}: ${home.status}`)
    const base = homepage.replace(/\/$/, '')
    const problems = []
    const llms = await get(`${base}/llms.txt`)
    if (!llms.ok) problems.push(`llms.txt: ${llms.status}`)
    const full = await get(`${base}/llms-full.txt`)
    for (const [file, response] of [['llms.txt', llms], ['llms-full.txt', full]]) {
      if (!response.ok) continue
      try {
        if (/<example|Component omitted|<pm-install/.test(await response.text())) problems.push(`${file}: contains component placeholders`)
      }
      catch (error) { problems.push(`${file}: ${error.message}`) }
    }
    add('DOC-02', problems.length ? 'fail' : 'pass', problems.length ? list(problems) : 'llms.txt answers; available agent Markdown has no placeholders')
  }

  const entry = fleet.find(entry => entry.repository === repo)
  add('OPS-01', entry ? 'pass' : 'fail', entry ? 'listed in fleet/libraries.json' : 'not listed in fleet/libraries.json')
  for (const [id, check] of Object.entries(EVIDENCE_CHECKS)) {
    if (!publishes && LIBRARY_ONLY.has(id)) continue
    const evidence = entry?.evidence?.[id]
    add(id, typeof evidence === 'string' && evidence.trim() ? 'pass' : 'open',
      typeof evidence === 'string' && evidence.trim() ? evidence : `needs ${check} evidence in fleet/libraries.json`)
  }
  const runs = api(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=1`)
  if (!runs.ok) unverified('OPS-02', runs)
  else {
    const run = runs.data.workflow_runs?.[0]
    add('OPS-02', run?.conclusion === 'success' ? 'pass' : 'fail', run ? `latest completed ci.yml on main: ${run.conclusion}` : 'no completed ci.yml run on main')
  }
  const alerts = collection(`repos/${repo}/dependabot/alerts?state=open`)
  if (!alerts.ok) unverified('OPS-03', alerts)
  else {
    const dangerous = alerts.data.filter(alert => ['high', 'critical'].includes(alert.security_advisory?.severity))
    add('OPS-03', dangerous.length ? 'fail' : 'pass', `${dangerous.length} open high or critical Dependabot alerts`)
  }
  const branches = collection(`repos/${repo}/branches`)
  if (!branches.ok || !prs.ok) unverified('OPS-04', !branches.ok ? branches : prs)
  else {
    const stale = []
    const unreadable = []
    for (const branch of branches.data) {
      if (branch.name === 'main' || prs.data.some(pr => pr.head?.ref === branch.name && pr.head?.repo?.full_name === repo)) continue
      const commit = api(`repos/${repo}/commits/${encodeURIComponent(branch.commit.sha)}`)
      const date = commit.data?.commit?.committer?.date
      if (!commit.ok || !Number.isFinite(Date.parse(date))) unreadable.push(branch.name)
      else if (age(date) > 30) stale.push(branch.name)
    }
    add('OPS-04', stale.length || unreadable.length ? 'warn' : 'pass', [
      stale.length ? `branches older than 30 days without a PR: ${list(stale.slice(0, 10))}` : 'no abandoned branches',
      ...(unreadable.length ? [`commit dates unverified: ${list(unreadable.slice(0, 10))}`] : []),
    ].join('; '))
  }
  if (!prs.ok) unverified('OPS-05', prs)
  else {
    const stale = prs.data.filter(pr => age(pr.updated_at) > 14)
    add('OPS-05', stale.length ? 'warn' : 'pass', stale.length ? `PRs inactive for more than 14 days: ${list(stale.map(pr => `#${pr.number}`))}` : 'no inactive PRs')
  }
  return checklistItems(results, src, { publishes })
}

// ---------- CLI ----------

const LABEL = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', open: 'OPEN' }

async function main(argv) {
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/audit.mjs [OWNER/REPO ...] [--json]\n       node scripts/audit.mjs --local [DIR] [--json]\nWithout targets, audit every repository in fleet/libraries.json. Local mode audits stage 1 only.')
    return 0
  }
  const asJson = argv.includes('--json')
  const args = argv.filter(arg => arg !== '--json')
  const local = args[0] === '--local'
  const reports = []
  const report = (src, items) => {
    if (local) items = items.filter(item => item.stage === 1)
    reports.push({ repository: src.repository ?? src.label, stage: stageReached(items, local ? 1 : 5), items })
  }
  if (local) {
    const src = localSource(args[1] ?? '.')
    report(src, auditFiles(src))
  }
  else {
    const fleet = readFleet()
    const targets = args.length ? args : fleet.map(entry => entry.repository)
    for (const repository of targets) {
      try {
        const src = remoteSource(repository)
        const publishes = publicPackages(src).length > 0
        report(src, checklistItems([...auditFiles(src, { publishes }), ...(await auditSettings(src, { publishes, fleet }))], src, { publishes }))
      }
      catch (error) {
        // An unreadable source cannot establish any stage.
        reports.push({ repository, stage: 0, items: [{ id: 'FILE-01', stage: 1, check: 'auto', status: 'fail', detail: `repository unreadable: ${error.message}` }] })
      }
    }
  }
  if (asJson) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2))
  else {
    for (const { repository, stage, items } of reports) {
      console.log(`\n${repository}${local ? ' (local: stage 1 only)' : ''}`)
      for (let n = 1; n <= (local ? 1 : 5); n++) {
        const group = items.filter(item => item.stage === n)
        if (!group.length) continue
        console.log(`${n}. ${STAGES[n]}`)
        for (const { id, status, detail } of group) console.log(`  ${LABEL[status].padEnd(4)}  ${id}  ${detail}`)
      }
      console.log(`Stage reached: ${stage}. ${STAGES[stage]}`)
      const open = items.filter(item => item.status !== 'pass')
        .sort((a, b) => (a.stage <= stage ? 6 : a.stage) - (b.stage <= stage ? 6 : b.stage))
      console.log(`Open: ${open.length ? open.map(item => `${item.id} (${item.status === 'open' ? item.check : item.status})`).join(', ') : 'none'}`)
    }
  }
  return reports.some(report => report.items.some(item => item.status === 'fail')) ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2))
}
