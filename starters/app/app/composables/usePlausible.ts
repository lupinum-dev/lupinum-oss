export function usePlausible(): void {
  const scriptId = useRuntimeConfig().public.plausibleScriptId.trim()
  if (!scriptId) return
  useScriptPlausibleAnalytics({ scriptId, scriptOptions: { bundle: false } })
}
