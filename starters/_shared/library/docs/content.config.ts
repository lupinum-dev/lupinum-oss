import { defineGinkoDocsConfig } from '@lupinum/ginko-docs/content'

export default defineGinkoDocsConfig({
  site: {
    name: '{{TITLE}}',
    description: '{{DESCRIPTION}}',
    whenToUse: 'Use this site to learn and operate {{TITLE}}.',
  },
  locales: ['en'],
  blog: false,
})
