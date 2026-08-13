import eslint from '@eslint/js'

export default [
  eslint.configs.recommended,
  {
    ignores: ['dist/**', 'release-artifacts/**', '.preview-artifacts/**', 'docs/.nuxt/**', 'docs/.output/**'],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  },
]
