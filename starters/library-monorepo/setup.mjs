#!/usr/bin/env node
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { generate, parseArguments, requireValues, validateIdentity, validatePackageName } from '../_shared/generator.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node starters/library-monorepo/setup.mjs --output <new-dir> --name <slug> --title <title> --description <text> --repository lupinum-dev/<slug> --domain <slug>.lupinum.com --package @lupinum/<one> --package @lupinum/<two> [--package ...] [--primary @lupinum/<name>] [--plausible <id>]')
  process.exit(0)
}
const { values, lists } = parseArguments(args, {
  allowed: ['output', 'name', 'title', 'description', 'repository', 'domain', 'package', 'primary', 'plausible'],
  repeatable: ['package'],
})
requireValues(values, ['output', 'name', 'title', 'description', 'repository', 'domain'])
validateIdentity({ slug: values.get('name'), repository: values.get('repository'), domain: values.get('domain') })
const packages = lists.get('package')
if (packages.length < 2) throw new Error('The monorepo starter requires at least two --package values.')
for (const packageName of packages) validatePackageName(packageName)
if (new Set(packages).size !== packages.length) throw new Error('Package names must be unique.')
const directories = packages.map(name => name.split('/')[1])
if (new Set(directories).size !== directories.length) throw new Error('Package names must map to unique directory names.')
if (directories.includes('package-template')) throw new Error('The package directory name package-template is reserved by the starter.')
const documentationDependencies = new Set(['@lupinum/ginko-content', '@lupinum/ginko-docs', 'nuxt', 'nuxt-site-config', 'vue', 'vue-router'])
if (packages.some(name => documentationDependencies.has(name))) throw new Error('A package name collides with a documentation dependency.')
const primary = values.get('primary') ?? packages.at(-1)
if (!packages.includes(primary)) throw new Error('--primary must name one of the declared packages.')
const primaryDirectory = directories[packages.indexOf(primary)]

await generate({
  source: dirname(fileURLToPath(import.meta.url)),
  output: values.get('output'),
  replacements: new Map([
    ['SLUG', values.get('name')], ['TITLE', values.get('title')], ['DESCRIPTION', values.get('description')],
    ['GETTING_STARTED_DESCRIPTION_YAML', `Install ${values.get('title')} and use its primary package.`],
    ['REPOSITORY', values.get('repository')], ['DOMAIN', values.get('domain')],
    ['PRIMARY_PACKAGE', primary], ['PRIMARY_PACKAGE_DIR', primaryDirectory],
    ['PACKAGE_LIST_MARKDOWN', packages.map(name => `- \`${name}\` is an independent package in this fixed-version release set.`).join('\n')],
    ['PLAUSIBLE_ID', values.get('plausible')?.trim() ?? ''],
  ]),
  prepare: async temporary => {
    const source = join(temporary, 'packages', 'package-template')
    for (let index = 0; index < packages.length; index += 1) {
      const target = join(temporary, 'packages', directories[index])
      await cp(source, target, { recursive: true })
      for (const relative of ['package.json', 'README.md']) {
        const path = join(target, relative)
        const content = await readFile(path, 'utf8')
        await writeFile(path, content.replaceAll('{{PACKAGE_NAME}}', packages[index]).replaceAll('{{PACKAGE_DIR}}', directories[index]))
      }
    }
    await rm(source, { recursive: true })
  },
  finalize: async temporary => {
    const path = join(temporary, 'docs', 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.dependencies = Object.fromEntries([
      ...packages.map(name => [name, 'workspace:*']),
      ...Object.entries(manifest.dependencies),
    ])
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
  },
})
console.log(`Created ${values.get('title')} in ${values.get('output')}`)
