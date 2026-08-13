const initializer = 'window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()'

export function usePlausible(): void {
  const scriptId = useRuntimeConfig().public.plausibleScriptId.trim()
  if (!scriptId) return
  useHead({ script: [
    { key: 'plausible', src: `https://plausible.io/js/pa-${scriptId}.js`, async: true },
    { key: 'plausible-init', innerHTML: initializer },
  ] })
  useScriptPlausibleAnalytics({ scriptId, scriptOptions: { bundle: false } })
}
