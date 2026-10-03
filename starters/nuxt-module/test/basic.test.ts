import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

describe('module', async () => {
  await setup({ rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)) })

  it('renders the greeting in a Nuxt app', async () => {
    expect(await $fetch('/')).toContain('Hello, World.')
  })
})
