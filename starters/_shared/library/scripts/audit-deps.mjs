// Only production dependencies that reach a public workspace package block CI.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export function classifyAdvisories(report, importers) {
  if (!report.advisories || report.error) throw new Error('pnpm audit did not return advisories')
  return Object.values(report.advisories).map(advisory => ({
    ...advisory,
    blocks: ['high', 'critical'].includes(advisory.severity) && advisory.findings.some(finding =>
      finding.paths.some(path => importers.has(path.split('>')[0]))),
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const run = args => spawnSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 << 20 })
  const listed = run(['-r', 'ls', '--json', '--depth', '-1'])
  if (listed.status !== 0) throw new Error(listed.stderr || 'Cannot list workspace packages')
  const root = realpathSync('.')
  // pnpm 11 uses `.` for the root and replaces path separators with `__`.
  const importers = new Set(JSON.parse(listed.stdout).filter(pkg => !pkg.private).map(pkg =>
    relative(root, pkg.path).split(sep).join('__') || '.'))
  const audited = run(['audit', '--prod', '--json']) // findings make pnpm exit nonzero
  const findings = classifyAdvisories(JSON.parse(audited.stdout), importers)
  for (const finding of findings) {
    console.log(`${finding.blocks ? '::error::' : '::warning::'}${finding.severity}: ${finding.title} ${finding.url ?? ''}`)
  }
  process.exitCode = findings.some(finding => finding.blocks) ? 1 : 0
}
