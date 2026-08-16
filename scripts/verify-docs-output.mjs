import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const outputCandidates = [
  process.env.DOCS_OUTPUT_ROOT,
  '.vercel/output/static',
  'docs/.vercel/output/static',
  'docs/.output/public',
].filter(Boolean)

const outputRoot = outputCandidates.find(candidate => existsSync(candidate))

if (!outputRoot) {
  throw new Error('Documentation build output is missing.')
}

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectHtmlFiles(entryPath))
    }
    else if (entry.name.endsWith('.html')) {
      files.push(entryPath)
    }
  }

  return files
}

const htmlFiles = await collectHtmlFiles(outputRoot)
const referencedAssets = new Set()

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8')

  for (const match of html.matchAll(/(?:src|href)=["']\/?(_nuxt\/[^"'#?]+)/g)) {
    referencedAssets.add(decodeURIComponent(match[1]))
  }
}

const missingAssets = [...referencedAssets]
  .filter(asset => !existsSync(path.join(outputRoot, asset)))
  .sort()

if (missingAssets.length > 0) {
  throw new Error(`Documentation output references missing assets:\n${missingAssets.join('\n')}`)
}

console.log(
  `Verified ${referencedAssets.size} documentation assets across ${htmlFiles.length} HTML files.`,
)
