import { addImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit'

export interface ModuleOptions {
  /**
   * The greeting `useGreeting()` puts before the name.
   * @default 'Hello'
   */
  greeting: string
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '{{PACKAGE_NAME}}',
    configKey: '{{CONFIG_KEY}}',
  },
  defaults: {
    greeting: 'Hello',
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    nuxt.options.runtimeConfig.public.{{CONFIG_KEY}} = { greeting: options.greeting }
    addImportsDir(resolver.resolve('./runtime/composables'))
  },
})
