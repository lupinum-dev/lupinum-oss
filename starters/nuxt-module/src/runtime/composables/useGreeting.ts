import { useRuntimeConfig } from '#imports'

/**
 * Returns a greeting for `name`, using the `greeting` module option.
 * @example useGreeting('World') // 'Hello, World.'
 */
export function useGreeting(name: string): string {
  const { greeting } = useRuntimeConfig().public.{{CONFIG_KEY}} as { greeting: string }
  return `${greeting}, ${name}.`
}
