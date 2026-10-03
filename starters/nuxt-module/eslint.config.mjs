// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: { tooling: true, stylistic: true },
  dirs: { src: ['./playground'] },
}).append({
  ignores: ['dist/**', 'release/**', 'docs/.nuxt/**', 'docs/.output/**', 'playground/.nuxt/**', 'playground/.output/**'],
})
