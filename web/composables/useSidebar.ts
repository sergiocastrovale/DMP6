import { useWindowSize } from '@vueuse/core'

export const useSidebar = () => {
  // What the user (or the narrow-viewport rule) wants. The Labs rail is deliberately NOT stored
  // here: `useSidebar()` re-runs its width watcher on every call, so anything written into this ref
  // from outside would be clobbered by the next call site that happens to invoke the composable.
  const userCollapsed = useState('sidebar-collapsed', () => false)
  // Once the user has manually toggled the sidebar, their choice wins over the width-based
  // default for the rest of the session - without this, resizing the window while narrow (even
  // by a pixel, e.g. a scrollbar appearing) snapped a manually-expanded sidebar back closed.
  const manuallySet = useState('sidebar-manually-set', () => false)
  // Set by useChrome().rail() for Labs, whose pages are full-width canvases. Kept separate so
  // leaving Labs restores the user's own width without having to remember and replay it.
  const railed = useState('sidebar-railed', () => false)
  const { width } = useWindowSize()

  watch(width, (w) => {
    if (w > 0 && !manuallySet.value) {
      userCollapsed.value = w <= 720
    }
  }, { immediate: true })

  const collapsed = computed(() => railed.value || userCollapsed.value)

  const toggle = () => {
    manuallySet.value = true
    // Expanding out of the Labs rail is a real choice, so it leaves the rail rather than fighting
    // it - the chevron in the rail points outward for exactly this reason.
    if (railed.value) {
      railed.value = false
      userCollapsed.value = false
      return
    }
    userCollapsed.value = !userCollapsed.value
  }

  const setRailed = (value: boolean) => {
    railed.value = value
  }

  return {
    collapsed,
    toggle,
    setRailed,
  }
}
