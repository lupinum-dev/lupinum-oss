import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'))
const sourceCommit = process.env.SOURCE_COMMIT
if (manifest.sourceSha !== sourceCommit || process.env.PREVIEW_SHA !== sourceCommit) throw new Error('Preview commit differs from the pull request commit.')
const returnedUrls = new Set(process.env.PREVIEW_URLS?.match(/https:\/\/\S+/gu) ?? [])
if (returnedUrls.size !== manifest.packages.length) throw new Error('pkg.pr.new returned an unexpected URL count.')
for (const pkg of manifest.packages) {
  const expected = `https://pkg.pr.new/${process.env.GITHUB_REPOSITORY}/${pkg.name}@${sourceCommit}`
  if (!returnedUrls.has(expected)) throw new Error(`Missing ${expected}.`)
  const response = await fetch(expected, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Cannot download ${expected}: HTTP ${response.status}.`)
  const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
  if (digest !== pkg.sha256) throw new Error(`Hosted bytes differ for ${pkg.name}.`)
}
console.log(`Verified ${manifest.packages.length} package preview(s).`)
