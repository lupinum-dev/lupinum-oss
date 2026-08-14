#!/usr/bin/env node
import { dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { generate, parseArguments, requireValues, validateIdentity, validatePackageName } from '../_shared/generator.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node starters/library/setup.mjs --output <new-dir> --name <slug> --title <title> --description <text> --repository lupinum-dev/<slug> --domain <slug>.lupinum.com [--package @lupinum/<slug>] [--plausible <id>]')
  process.exit(0)
}
const { values } = parseArguments(args, { allowed: ['output', 'name', 'title', 'description', 'repository', 'domain', 'package', 'plausible'] })
requireValues(values, ['output', 'name', 'title', 'description', 'repository', 'domain'])
const slug = values.get('name')
const packageName = values.get('package') ?? `@lupinum/${slug}`
validateIdentity({ slug, repository: values.get('repository'), domain: values.get('domain') })
validatePackageName(packageName)
await generate({
  source: dirname(fileURLToPath(import.meta.url)),
  output: values.get('output'),
  replacements: new Map([
    ['SLUG', slug], ['TITLE', values.get('title')], ['DESCRIPTION', values.get('description')],
    ['GETTING_STARTED_DESCRIPTION_YAML', `Install ${values.get('title')} and use its first API.`],
    ['REPOSITORY', values.get('repository')], ['DOMAIN', values.get('domain')],
    ['PACKAGE_NAME', packageName], ['PACKAGE_FILE', packageName.replace(/^@/, '').replace('/', '-')],
    ['PLAUSIBLE_ID', values.get('plausible')?.trim() ?? ''],
  ]),
})
console.log(`Created ${values.get('title')} in ${values.get('output')}`)
