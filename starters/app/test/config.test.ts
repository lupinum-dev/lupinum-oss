import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('application configuration', () => {
  it('keeps the canonical domain in configuration', () => {
    expect(readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')).toContain('https://{{DOMAIN}}')
  })
})
