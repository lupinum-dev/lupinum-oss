export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/scripts'],
  devtools: { enabled: true },
  app: {
    head: {
      title: '{{TITLE}}',
      meta: [{ name: 'description', content: '{{DESCRIPTION}}' }],
      link: [{ rel: 'canonical', href: 'https://{{DOMAIN}}' }],
    },
  },
  runtimeConfig: { public: { plausibleScriptId: '{{PLAUSIBLE_ID}}' } },
})
