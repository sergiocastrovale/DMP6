import type { ComputedRef, Ref } from 'vue'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Not `el.offsetParent !== null` - that requires a real layout engine to have run, which a
// headless test DOM (happy-dom) never does, making every element look hidden there. The native
// `hidden` attribute needs no layout and is enough for what this app actually hides content with.
const focusableIn = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(el => !el.hidden)

// Traps Tab/Shift+Tab focus cycling inside `containerRef` while `active` is true: moves focus
// into the container on activation, wraps Tab at the last focusable back to the first (and vice
// versa for Shift+Tab), and restores focus to whatever had it beforehand once `active` goes
// false again. Dialogs must never leak keyboard focus onto the page behind them, and must give
// it back to the element that opened them - a plain v-if with no trap does neither.
export const useFocusTrap = (containerRef: Ref<HTMLElement | null | undefined>, active: Ref<boolean> | ComputedRef<boolean>) => {
  let previouslyFocused: HTMLElement | null = null

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') {
      return
    }
    const container = containerRef.value
    if (!container) {
      return
    }
    const items = focusableIn(container)
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) {
      event.preventDefault()
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
    else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activate = () => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKeydown)
    const container = containerRef.value
    const target = container ? (focusableIn(container)[0] ?? container) : null
    target?.focus()
  }

  const deactivate = () => {
    document.removeEventListener('keydown', onKeydown)
    previouslyFocused?.focus()
    previouslyFocused = null
  }

  // Two entry points on purpose. `active` can already be true on the container's very first
  // render (a dialog mounted with v-model already open) - onMounted is what guarantees the
  // template ref has bound by the time it runs. A later true->false->true toggle on an
  // already-mounted container goes through the `flush: 'post'` watcher instead, which is only
  // ever meaningful for a value CHANGE, so it doesn't need (and must not use) `immediate`: an
  // immediate watcher callback runs synchronously at the `watch()` call site, before the
  // component has rendered anything, which is before onMounted and defeats flush: 'post' entirely.
  onMounted(() => {
    if (active.value) {
      activate()
    }
  })

  watch(active, (isActive) => {
    if (isActive) {
      activate()
    }
    else {
      deactivate()
    }
  }, { flush: 'post' })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
  })
}
