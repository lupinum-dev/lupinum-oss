#!/usr/bin/env node
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { baseReplacements, consumerOnboarding, generate, parseArguments, validatePackageName } from '../_shared/generator.mjs'

const usage = 'Usage: node starters/library-monorepo/setup.mjs --output <new-dir> --name <slug> --title <title> --description <text> --repository lupinum-dev/<slug> --domain <slug>.lupinum.com --package @lupinum/<one> --package @lupinum/<two> [--package ...] [--primary @lupinum/<name>] [--plausible <id>]'
const { help, values, lists } = parseArguments(process.argv.slice(2), {
  allowed: ['output', 'name', 'title', 'description', 'repository', 'domain', 'package', 'primary', 'plausible'],
  required: ['output', 'name', 'title', 'description', 'repository', 'domain'],
  repeatable: ['package'],
})
if (help) {
  console.log(usage)
  process.exit(0)
}
const packages = lists.get('package')
if (packages.length < 2) throw new Error('The monorepo starter requires at least two --package values.')
for (const packageName of packages) validatePackageName(packageName)
const directories = packages.map(name => name.split('/')[1])
if (new Set(packages).size !== packages.length) throw new Error('Package names must be unique.')
if (new Set(directories).size !== directories.length) throw new Error('Package names must map to unique directory names.')
if (directories.includes('package-template')) throw new Error('The package directory name package-template is reserved.')
const primary = values.get('primary') ?? packages.at(-1)
if (!packages.includes(primary)) throw new Error('--primary must name one of the declared packages.')

await generate({
  source: dirname(fileURLToPath(import.meta.url)),
  layers: ['common', 'library'],
  output: values.get('output'),
  replacements: [
    ...baseReplacements(values, 'library-monorepo'),
    ['PRIMARY_PACKAGE', primary], ['PRIMARY_PACKAGE_DIR', directories[packages.indexOf(primary)]],
    ['PREVIEW_PACKAGES', "'./packages/*'"],
    ['GETTING_STARTED_DESCRIPTION_YAML', `Install ${values.get('title')} and use its primary package.`],
    ['PACKAGE_LIST_MARKDOWN', packages.map(name => `- \`${name}\``).join('\n')],
    ['CONSUMER_ONBOARDING_MARKDOWN', await consumerOnboarding(primary)],
  ],
  // One directory per package, created from packages/package-template. Each package README
  // carries its own agent setup, because npm and node_modules show that README, not the root one.
  prepare: async temporary => {
    const template = join(temporary, 'packages', 'package-template')
    for (const [index, directory] of directories.entries()) {
      const target = join(temporary, 'packages', directory)
      await cp(template, target, { recursive: true })
      await cp(join(temporary, 'LICENSE'), join(target, 'LICENSE'))
      for (const file of ['package.json', 'README.md']) {
        const path = join(target, file)
        const content = await readFile(path, 'utf8')
        await writeFile(path, content.replaceAll('{{PACKAGE_ONBOARDING}}', await consumerOnboarding(packages[index]))
          .replaceAll('{{PACKAGE_NAME}}', packages[index]).replaceAll('{{PACKAGE_DIR}}', directory))
      }
    }
    await rm(template, { recursive: true })
  },
  // All packages release together with one version.
  finalize: async temporary => {
    const path = join(temporary, '.changeset', 'config.json')
    const config = JSON.parse(await readFile(path, 'utf8'))
    config.fixed = [packages]
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)
  },
})
console.log(`Created ${values.get('title')} in ${values.get('output')}.
Next: pnpm install, pnpm verify, commit pnpm-lock.yaml, then follow "Set up a repository" in the Lupinum OSS handbook.`)
