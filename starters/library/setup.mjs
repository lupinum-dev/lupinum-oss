#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

const source = dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node starters/library/setup.mjs --output <empty-dir> --name <slug> --title <title> --description <text> --repository lupinum-dev/<slug> --domain <slug>.lupinum.com [--package @lupinum/<slug>] --plausible <id>')
  process.exit(0)
}
const values = new Map()
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]
  const value = args[index + 1]
  if (!flag?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${flag ?? 'end of command'}.`)
  values.set(flag.slice(2), value)
}
for (const key of ['output', 'name', 'title', 'description', 'repository', 'domain', 'plausible']) {
  if (!values.get(key)?.trim()) throw new Error(`Missing --${key}.`)
}
const slug = values.get('name')
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('--name must be a lowercase kebab-case slug.')
const packageName = values.get('package') ?? `@lupinum/${slug}`
if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(packageName)) throw new Error('--package must be a scoped npm package name.')
if (!/^[a-z0-9][a-z0-9._-]+\/[a-z0-9][a-z0-9._-]+$/.test(values.get('repository'))) throw new Error('--repository must use owner/name.')
const output = resolve(values.get('output'))
try { await stat(output); throw new Error(`Output already exists: ${output}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(output, { recursive: false })
await cp(source, output, { recursive: true, filter: path => !['setup.mjs', 'template.json'].includes(basename(path)) })

const replacements = new Map([
  ['{{SLUG}}', slug],
  ['{{TITLE}}', values.get('title')],
  ['{{DESCRIPTION}}', values.get('description')],
  ['{{REPOSITORY}}', values.get('repository')],
  ['{{DOMAIN}}', values.get('domain')],
  ['{{PACKAGE_NAME}}', packageName],
  ['{{PACKAGE_FILE}}', packageName.replace(/^@/, '').replace('/', '-')],
  ['{{PLAUSIBLE_ID}}', values.get('plausible')],
])
const textExtensions = new Set(['', '.json', '.md', '.mjs', '.ts', '.yml', '.yaml', '.vue', '.css', '.svg', '.gitignore'])
async function materialize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await materialize(path)
    else if (textExtensions.has(entry.name === '.gitignore' ? '.gitignore' : entry.name.slice(entry.name.lastIndexOf('.')))) {
      let content = await readFile(path, 'utf8')
      for (const [token, value] of replacements) content = content.replaceAll(token, value)
      if (/\{\{[A-Z0-9_]+\}\}/.test(content)) throw new Error(`Unresolved template token in ${path}.`)
      await writeFile(path, content)
    }
  }
}
await materialize(output)
await rm(join(output, '.DS_Store'), { force: true })
console.log(`Created ${values.get('title')} in ${output}`)
