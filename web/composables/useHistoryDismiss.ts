// Closes a full-screen sheet on the Android/browser back gesture, without touching the route.
// Pushes a same-URL history sentinel on mount so one back-press pops it instead of navigating
// away; on any other close path (chevron, Escape) it pops that same sentinel itself so the
// history stack stays balanced and a second back-press doesn't land on a dead entry.
//
// Spreading the existing history.state is load-bearing: vue-router 4 stores its own
// { back, current, forward, position, replaced, scroll } there and reads it on every navigation.
// A bare pushState({}, '') would clobber that and desync the router. The URL is unchanged, so
// vue-router's own popstate handler resolves this as a duplicated navigation to the same route
// and no-ops - it never sees this as a real back.
export const useHistoryDismiss = (close: () => void) => {
  let poppingSelf = false

  const onPopState = () => {
    if (poppingSelf) {
      poppingSelf = false
      return
    }
    close()
  }

  onMounted(() => {
    history.pushState({ ...history.state, dmpSheetOpen: true }, '')
    window.addEventListener('popstate', onPopState)
  })

  onBeforeUnmount(() => {
    // back() before removing the listener: jsdom/happy-dom dispatch popstate synchronously (a
    // real browser doesn't, but by the time its async popstate arrives the listener below has
    // long since been removed either way) - this order is what lets poppingSelf actually catch
    // and swallow the self-triggered pop instead of it looking like a real back-press.
    if (history.state?.dmpSheetOpen) {
      poppingSelf = true
      history.back()
    }
    window.removeEventListener('popstate', onPopState)
  })
}
