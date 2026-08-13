import { defineGinkoDocsConfig } from '@lupinum/ginko-docs/content'

export default defineGinkoDocsConfig({
  site: { name: '{{TITLE}}', description: '{{DESCRIPTION}}', url: 'https://{{DOMAIN}}' },
  locales: ['en'],
  blog: false,
})
