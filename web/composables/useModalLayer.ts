import type { Ref } from 'vue'
import { isEmpty, isTop, push, remove } from '~/helpers/dialogStack'

// Shared modal-shell mechanics: dialog-stack membership (so only the topmost overlay reacts to
// Escape and traps Tab), body scroll lock (released only once the LAST open overlay closes), and
// focus trap/restore. Extracted from Dialog.vue - promoted here on its second occurrence
// (BrowseFiltersSidebar is a right-docked panel, not a centered dialog, so it can't reuse
// Dialog.vue itself, but it must behave identically as an overlay).
export const useModalLayer = (isOpen: Ref<boolean>, panelRef: Ref<HTMLElement | undefined>, close: () => void) => {
  // Own identity in the stack: two open overlays are DOM siblings (both teleported to body), so
  // there is no parent/child relationship to lean on for "which one is on top" - each instance
  // registers itself here instead.
  const layerId = Symbol('modal-layer')

  useFocusTrap(panelRef, isOpen, () => isTop(layerId))

  const onKeydown = (event: KeyboardEvent) => {
    // A stacked overlay underneath must not also close on the Escape that closes the one on top of it.
    if (event.key === 'Escape' && isTop(layerId)) {
      close()
    }
  }

  // onMounted (not an immediate watcher) for the initial state - this runs during Nuxt's SSR
  // setup() too, where `document` doesn't exist; onMounted is guaranteed client-only.
  const applyOpenEffects = (open: boolean) => {
    if (open) {
      push(layerId)
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
    }
    else {
      remove(layerId)
      document.removeEventListener('keydown', onKeydown)
      // Only once the LAST open overlay closes - an inner one closing must not unlock scroll out
      // from under one still open behind it.
      if (isEmpty()) {
        document.body.style.overflow = ''
      }
    }
  }

  onMounted(() => {
    if (isOpen.value) {
      applyOpenEffects(true)
    }
  })

  watch(isOpen, applyOpenEffects)

  onBeforeUnmount(() => {
    remove(layerId)
    document.removeEventListener('keydown', onKeydown)
    if (isOpen.value && isEmpty()) {
      document.body.style.overflow = ''
    }
  })

  return { isTop: () => isTop(layerId) }
}
