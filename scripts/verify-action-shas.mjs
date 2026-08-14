import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'

const token = process.env.GITHUB_TOKEN
if (!token) throw new Error('GITHUB_TOKEN is required for upstream action verification.')

async function workflowFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await workflowFiles(path))
    else if (/\.ya?ml$/u.test(entry.name)) files.push(path)
  }
  return files
}

const roots = [
  '.github/workflows',
  'starters/app/.github/workflows',
  'starters/library/.github/workflows',
  'starters/library-monorepo/.github/workflows',
]
const references = new Set()
for (const root of roots) {
  for (const path of await workflowFiles(root)) {
    const workflow = parse(await readFile(path, 'utf8'))
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const match = String(step.uses ?? '').match(/^([^/]+\/[^/@]+)(?:\/[^@]+)?@([0-9a-f]{40})$/u)
        if (match) references.add(`${match[1]}@${match[2]}`)
      }
    }
  }
}
if (references.size === 0) throw new Error('No pinned action references were found.')

for (const reference of [...references].sort()) {
  const [repository, sha] = reference.split('@')
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${sha}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`${reference} is not a valid upstream commit: HTTP ${response.status}.`)
  const commit = await response.json()
  if (commit.sha !== sha) throw new Error(`${reference} resolved to ${commit.sha}.`)
  console.log(`Verified ${reference}.`)
}
