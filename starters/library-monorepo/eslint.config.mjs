import eslint from '@eslint/js'
export default [eslint.configs.recommended, { ignores: ['**/dist/**', 'release-artifacts/**', '.preview-artifacts/**', 'docs/.nuxt/**', 'docs/.output/**'] }]
