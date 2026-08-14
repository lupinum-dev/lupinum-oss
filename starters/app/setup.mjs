#!/usr/bin/env node
import { dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { generate, parseArguments, requireValues, validateIdentity } from '../_shared/generator.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node starters/app/setup.mjs --output <new-dir> --name <slug> --title <title> --description <text> --repository lupinum-dev/<slug> --domain <slug>.lupinum.com [--plausible <id>]')
  process.exit(0)
}
const { values } = parseArguments(args, { allowed: ['output', 'name', 'title', 'description', 'repository', 'domain', 'plausible'] })
requireValues(values, ['output', 'name', 'title', 'description', 'repository', 'domain'])
validateIdentity({ slug: values.get('name'), repository: values.get('repository'), domain: values.get('domain') })
await generate({
  source: dirname(fileURLToPath(import.meta.url)),
  output: values.get('output'),
  replacements: new Map([
    ['SLUG', values.get('name')], ['TITLE', values.get('title')], ['DESCRIPTION', values.get('description')],
    ['REPOSITORY', values.get('repository')], ['DOMAIN', values.get('domain')],
    ['PLAUSIBLE_ID', values.get('plausible')?.trim() ?? ''],
  ]),
})
console.log(`Created ${values.get('title')} in ${values.get('output')}`)
