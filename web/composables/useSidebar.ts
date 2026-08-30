import { useWindowSize } from '@vueuse/core'

export const useSidebar = () => {
  const collapsed = useState('sidebar-collapsed', () => false)
  // Once the user has manually toggled the sidebar, their choice wins over the width-based
  // default for the rest of the session - without this, resizing the window while narrow (even
  // by a pixel, e.g. a scrollbar appearing) snapped a manually-expanded sidebar back closed.
  const manuallySet = useState('sidebar-manually-set', () => false)
  const { width } = useWindowSize()

  watch(width, (w) => {
    if (w > 0 && !manuallySet.value) {
      collapsed.value = w <= 720
    }
  }, { immediate: true })

  const toggle = () => {
    manuallySet.value = true
    collapsed.value = !collapsed.value
  }

  return {
    collapsed: readonly(collapsed),
    toggle,
  }
}
