#!/usr/bin/env node
import { dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { baseReplacements, consumerOnboarding, generate, parseArguments, validatePackageName } from '../_shared/generator.mjs'

const usage = 'Usage: node starters/library/setup.mjs --output <new-dir> --name <slug> --title <title> --description <text> --repository lupinum-dev/<slug> --domain <slug>.lupinum.com [--package @lupinum/<slug>] [--plausible <id>]'
const { help, values } = parseArguments(process.argv.slice(2), {
  allowed: ['output', 'name', 'title', 'description', 'repository', 'domain', 'package', 'plausible'],
  required: ['output', 'name', 'title', 'description', 'repository', 'domain'],
})
if (help) {
  console.log(usage)
  process.exit(0)
}
const packageName = values.get('package') ?? `@lupinum/${values.get('name')}`
validatePackageName(packageName)

await generate({
  source: dirname(fileURLToPath(import.meta.url)),
  layers: ['common', 'library'],
  output: values.get('output'),
  replacements: [
    ...baseReplacements(values, 'library'),
    ['PACKAGE_NAME', packageName], ['PRIMARY_PACKAGE', packageName], ['PREVIEW_PACKAGES', '.'],
    ['GETTING_STARTED_DESCRIPTION_YAML', `Install ${values.get('title')} and use its first API.`],
    ['CONSUMER_ONBOARDING_MARKDOWN', await consumerOnboarding(packageName)],
  ],
})
console.log(`Created ${values.get('title')} in ${values.get('output')}.
Next: pnpm install, pnpm verify, commit pnpm-lock.yaml, then follow "Set up a repository" in the Lupinum OSS handbook.`)
