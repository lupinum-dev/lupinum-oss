import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

const actionReference = /^[a-z0-9_.-]+\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*@[0-9a-f]{40}$/iu

export async function readWorkflow(path) {
  const source = await readFile(path, 'utf8')
  const workflow = parse(source)
  if (!workflow || typeof workflow !== 'object' || !workflow.jobs || typeof workflow.jobs !== 'object') {
    throw new Error(`${path} does not define workflow jobs.`)
  }
  return { source, workflow }
}

export function checkWorkflow(path, workflow) {
  const failures = []
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    const permissions = job.permissions ?? workflow.permissions
    if (permissions === 'write-all') failures.push(`${path} job ${jobName} grants write-all.`)
    if (permissions && typeof permissions === 'object') {
      for (const [scope, level] of Object.entries(permissions)) {
        if (!['read', 'write', 'none'].includes(level)) failures.push(`${path} job ${jobName} has invalid ${scope} permission ${level}.`)
      }
    }
    for (const step of job.steps ?? []) {
      if (!step.uses) continue
      if (!actionReference.test(step.uses)) failures.push(`${path} uses a mutable action reference: ${step.uses}`)
      if (step.uses.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) {
        failures.push(`${path} job ${jobName} persists checkout credentials.`)
      }
    }
  }
  return failures
}

function samePermissions(actual, expected) {
  if (!actual || typeof actual !== 'object') return false
  const entries = Object.entries(actual).sort()
  const wanted = Object.entries(expected).sort()
  return JSON.stringify(entries) === JSON.stringify(wanted)
}

export function checkPreviewWorkflow(path, workflow) {
  const failures = []
  const job = workflow.jobs.preview
  if (!samePermissions(workflow.permissions, { contents: 'read' }) || job?.permissions) failures.push(`${path} preview must have only contents: read.`)
  if (!String(job?.if ?? '').includes('github.event.pull_request.head.repo.full_name == github.repository')) failures.push(`${path} preview must reject automatic fork execution.`)
  const checkout = job?.steps?.find(step => String(step.uses ?? '').startsWith('actions/checkout@'))
  if (checkout?.with?.ref !== '${{ github.event.pull_request.head.sha || github.sha }}') failures.push(`${path} preview must check out the exact pull request SHA.`)
  const pack = job?.steps?.find(step => String(step.run ?? '').includes('preview:pack'))
  if (pack?.env?.GITHUB_SHA !== '${{ github.event.pull_request.head.sha || github.sha }}') failures.push(`${path} preview must bind its manifest to the checked-out pull request SHA.`)
  return failures
}

export function checkCiWorkflow(path, workflow) {
  const failures = []
  if (!samePermissions(workflow.permissions, { contents: 'read' })) failures.push(`${path} CI must have only contents: read.`)
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (job.permissions) failures.push(`${path} CI job ${jobName} must not override workflow permissions.`)
  }
  return failures
}

function checkInertPrivilegedJob(path, jobName, job) {
  const failures = []
  const steps = job?.steps ?? []
  if (steps.some(step => String(step.uses ?? '').startsWith('actions/checkout@'))) failures.push(`${path} ${jobName} job checks out repository code.`)
  const runs = steps.map(step => step.run ?? '').join('\n')
  if (/(?:^|\s)(?:pnpm|yarn|bun)\s+(?:install|run|exec)|npm\s+(?:install|ci)|node\s+(?:\.\/)?scripts\//mu.test(runs)) {
    failures.push(`${path} ${jobName} job installs dependencies or executes a repository script.`)
  }
  return failures
}

export function checkPublishWorkflow(path, workflow) {
  const failures = []
  const certify = workflow.jobs.certify
  const publish = workflow.jobs.publish
  const release = workflow.jobs['github-release']
  if (!samePermissions(workflow.permissions, {})) failures.push(`${path} must deny permissions by default.`)
  if (!samePermissions(certify?.permissions, { contents: 'read' })) failures.push(`${path} certify job must have only contents: read.`)
  if (!samePermissions(publish?.permissions, { actions: 'read', contents: 'read', 'id-token': 'write' })) failures.push(`${path} publish job permissions differ from the protected contract.`)
  if (!samePermissions(release?.permissions, { actions: 'read', contents: 'write' })) failures.push(`${path} GitHub release job permissions differ from the protected contract.`)
  if (publish?.environment !== 'npm') failures.push(`${path} publish job must use the npm environment.`)
  failures.push(...checkInertPrivilegedJob(path, 'publish', publish))
  failures.push(...checkInertPrivilegedJob(path, 'GitHub release', release))
  return failures
}

export function containsNpmCredential(source) {
  return /(?:^|\n)\s*(?:export\s+)?(?:NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_TOKEN|npm_config__authToken)\s*[:=]/mu.test(source)
    || /secrets\.(?:NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_TOKEN)\b/u.test(source)
    || /(?:^|\n)\s*(?:\/\/[^\n]*:)?_authToken\s*=/mu.test(source)
    || /--[^\s]*_authToken(?:=|\s)/u.test(source)
}
