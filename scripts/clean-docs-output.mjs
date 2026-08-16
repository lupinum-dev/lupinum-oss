import { rm } from 'node:fs/promises'

const generatedOutputs = [
  '.vercel/output',
  'docs/.vercel/output',
  'docs/.output',
]

await Promise.all(
  generatedOutputs.map(output => rm(output, { force: true, recursive: true })),
)
