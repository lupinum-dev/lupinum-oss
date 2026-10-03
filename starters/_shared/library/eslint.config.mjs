// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// Lints TypeScript and Vue as well as scripts; works without a Nuxt app.
export default createConfigForNuxt({
  features: { tooling: true, stylistic: true },
}).append({
  ignores: ['**/dist/**', 'release/**', 'docs/.nuxt/**', 'docs/.output/**'],
})
