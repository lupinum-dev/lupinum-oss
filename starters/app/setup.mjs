#!/usr/bin/env node
import { dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { baseReplacements, generate, parseArguments } from '../_shared/generator.mjs'

const usage = 'Usage: node starters/app/setup.mjs --output <new-dir> --name <slug> --title <title> --description <text> --repository lupinum-dev/<slug> --domain <slug>.lupinum.com [--plausible <id>]'
const { help, values } = parseArguments(process.argv.slice(2), {
  allowed: ['output', 'name', 'title', 'description', 'repository', 'domain', 'plausible'],
  required: ['output', 'name', 'title', 'description', 'repository', 'domain'],
})
if (help) {
  console.log(usage)
  process.exit(0)
}

await generate({
  source: dirname(fileURLToPath(import.meta.url)),
  layers: ['common'],
  output: values.get('output'),
  replacements: baseReplacements(values, 'app'),
})
console.log(`Created ${values.get('title')} in ${values.get('output')}.
Next: pnpm install, pnpm verify, commit pnpm-lock.yaml, then follow "Set up a repository" in the Lupinum OSS handbook.`)
