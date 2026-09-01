// Shared open/close state for a trigger + floating panel (dropdown, filter popover, menu):
// Escape closes and returns focus to the trigger, and a `fixed inset-0` backdrop closes on any
// outside click. `@vueuse/core`'s `onClickOutside` was tried here and reverted - see
// docs/design_system.md - so this stays the backdrop-div approach, just with one definition
// instead of four near-identical copies.
export const useDismissable = () => {
  const open = ref(false)
  const triggerRef = ref<HTMLElement>()

  const close = () => {
    open.value = false
  }

  const toggle = () => {
    open.value = !open.value
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close()
      triggerRef.value?.focus()
    }
  }

  // document is undefined during SSR - open always starts false, so there is nothing to attach
  // on the very first (server) render anyway. A plain (non-immediate) watch only ever fires in
  // response to a later, client-side change, which is exactly what this needs.
  watch(open, (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', onKeydown)
    }
    else {
      document.removeEventListener('keydown', onKeydown)
    }
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
  })

  return { open, triggerRef, toggle, close }
}
