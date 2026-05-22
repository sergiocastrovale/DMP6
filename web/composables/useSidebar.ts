import { useWindowSize } from '@vueuse/core'

export const useSidebar = () => {
  const collapsed = useState('sidebar-collapsed', () => false)
  const { width } = useWindowSize()

  watch(width, (w) => {
    if (w > 0) {
      collapsed.value = w <= 720
    }
  }, { immediate: true })

  const toggle = () => {
    collapsed.value = !collapsed.value
  }

  return {
    collapsed: readonly(collapsed),
    toggle,
  }
}
