// Shared by the starter setup scripts. A generated repository is built from
// layers: `_shared/common/` (every starter), optionally `_shared/library/`
// (npm libraries), then the starter directory itself. Files in a later layer
// replace files in an earlier one. `{{TOKEN}}` placeholders are then replaced,
// encoded for the file type they appear in.
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shared = dirname(fileURLToPath(import.meta.url))
const tokenPattern = /\{\{([A-Z0-9_]+)\}\}/g

export function parseArguments(args, { allowed, required, repeatable = [] }) {
  if (args.includes('--help')) return { help: true }
  const values = new Map()
  const lists = new Map(repeatable.map(key => [key, []]))
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${flag ?? 'end of command'}.`)
    const key = flag.slice(2)
    if (!allowed.includes(key)) throw new Error(`Unknown option --${key}.`)
    if (lists.has(key)) lists.get(key).push(value)
    else if (values.has(key)) throw new Error(`Duplicate --${key}.`)
    else values.set(key, value)
  }
  for (const key of required) if (!values.get(key)?.trim()) throw new Error(`Missing --${key}.`)
  const slug = values.get('name')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('--name must be a lowercase kebab-case slug.')
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(values.get('domain'))) throw new Error('--domain must be a hostname without a protocol or path.')
  if (!/^[a-z0-9][a-z0-9._-]+\/[a-z0-9][a-z0-9._-]+$/i.test(values.get('repository'))) throw new Error('--repository must use owner/name.')
  return { values, lists }
}

export function validatePackageName(name) {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`${name} is not a valid scoped npm package name.`)
}

// Replacements shared by every starter.
export function baseReplacements(values, starter) {
  return [
    ['SLUG', values.get('name')], ['TITLE', values.get('title')], ['DESCRIPTION', values.get('description')],
    ['REPOSITORY', values.get('repository')], ['DOMAIN', values.get('domain')],
    ['PLAUSIBLE_ID', values.get('plausible')?.trim() ?? ''],
    ['STARTER', starter], ['DATE', new Date().toISOString().slice(0, 10)],
  ]
}

// README and docs share one consumer prompt for coding agents.
export async function consumerOnboarding(packageName) {
  const source = await readFile(join(shared, 'consumer-onboarding.md'), 'utf8')
  return source.replaceAll('{{CONSUMER_PACKAGE}}', packageName).trimEnd()
}

function encoded(value, extension, key) {
  const text = String(value)
  if (key.endsWith('_YAML')) return JSON.stringify(text)
  if (key.endsWith('_MARKDOWN')) return text
  if (extension === '.json') return JSON.stringify(text).slice(1, -1)
  if (['.ts', '.mjs'].includes(extension)) return text.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  if (['.md', '.vue', '.svg', '.xml'].includes(extension)) return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replace(/[\r\n]+/g, ' ')
  return text
}

async function materialize(directory, replacements) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await materialize(path, replacements)
      continue
    }
    const extension = extname(entry.name) || entry.name
    let source = await readFile(path, 'utf8')
    source = source.replace(tokenPattern, (token, key) => replacements.has(key) ? encoded(replacements.get(key), extension, key) : token)
    const unresolved = source.match(tokenPattern)
    if (unresolved) throw new Error(`Unresolved template token ${unresolved[0]} in ${path}.`)
    await writeFile(path, source)
  }
}

// Writes into a temporary sibling directory and renames it at the end, so a
// failed run never leaves a half-generated repository behind.
export async function generate({ output: requestedOutput, layers, source, replacements, prepare, finalize }) {
  const output = resolve(requestedOutput)
  try {
    await stat(output)
    throw new Error(`Output already exists: ${output}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(dirname(output), { recursive: true })
  const temporary = await mkdtemp(join(dirname(output), `.${basename(output)}.tmp-`))
  const filter = path => !['setup.mjs', 'node_modules', '.DS_Store'].includes(basename(path))
  try {
    for (const layer of [...layers.map(name => join(shared, name)), source]) {
      await cp(layer, temporary, { recursive: true, filter })
    }
    if (prepare) await prepare(temporary)
    await materialize(temporary, new Map(replacements))
    if (finalize) await finalize(temporary)
    await rename(temporary, output)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}
