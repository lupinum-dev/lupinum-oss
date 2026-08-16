import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

const tokenPattern = /\{\{([A-Z0-9_]+)\}\}/g

export function parseArguments(args, { allowed, repeatable = [] }) {
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
  return { values, lists }
}

export function requireValues(values, keys) {
  for (const key of keys) if (!values.get(key)?.trim()) throw new Error(`Missing --${key}.`)
}

export function validateIdentity({ domain, repository, slug }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('--name must be a lowercase kebab-case slug.')
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) throw new Error('--domain must be a hostname without a protocol or path.')
  if (!/^[a-z0-9][a-z0-9._-]+\/[a-z0-9][a-z0-9._-]+$/i.test(repository)) throw new Error('--repository must use owner/name.')
}

export function validatePackageName(name) {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`${name} is not a valid scoped npm package name.`)
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
    let source
    try { source = await readFile(path, 'utf8') } catch { continue }
    const extension = extname(entry.name) || entry.name
    source = source.replace(tokenPattern, (token, key) => {
      if (!replacements.has(key)) return token
      return encoded(replacements.get(key), extension, key)
    })
    if (tokenPattern.test(source)) throw new Error(`Unresolved template token in ${path}.`)
    tokenPattern.lastIndex = 0
    await writeFile(path, source)
  }
}

export async function generate({ output: requestedOutput, replacements, source, prepare, finalize }) {
  const output = resolve(requestedOutput)
  try {
    await stat(output)
    throw new Error(`Output already exists: ${output}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const parent = dirname(output)
  await mkdir(parent, { recursive: true })
  const temporary = await mkdtemp(join(parent, `.${basename(output)}.tmp-`))
  try {
    await cp(source, temporary, { recursive: true, filter: path => basename(path) !== 'setup.mjs' })
    await mkdir(join(temporary, 'scripts'), { recursive: true })
    await cp(new URL('./verify-action-shas.mjs', import.meta.url), join(temporary, 'scripts', 'verify-action-shas.mjs'))
    if (prepare) await prepare(temporary)
    await materialize(temporary, replacements)
    if (finalize) await finalize(temporary)
    await rm(join(temporary, '.DS_Store'), { force: true })
    await rename(temporary, output)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}
