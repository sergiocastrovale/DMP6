export function useStreamMode() {
  const config = useRuntimeConfig()
  const isStreamMode = computed(() => 
    config.public.partyEnabled && config.public.partyRole === 'listener'
  )
  return { isStreamMode }
}
