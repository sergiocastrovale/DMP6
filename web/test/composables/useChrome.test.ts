import { beforeEach, describe, expect, it } from 'vitest'
import { useChrome } from '../../composables/useChrome'
import { useSidebar } from '../../composables/useSidebar'

describe('useChrome', () => {
  beforeEach(() => {
    useChrome().show()
  })

  it('defaults to the full shell', () => {
    expect(useChrome().visible.value).toBe(true)
    expect(useChrome().topbar.value).toBe(true)
  })

  it('hide() and show() toggle the shared state', () => {
    const chrome = useChrome()
    chrome.hide()
    expect(chrome.visible.value).toBe(false)
    // Shared (useState) - a second call site sees the same value.
    expect(useChrome().visible.value).toBe(false)
    chrome.show()
    expect(useChrome().visible.value).toBe(true)
  })

  it('rail() keeps the shell but narrows the sidebar and drops the topbar', () => {
    const chrome = useChrome()
    chrome.rail()
    expect(chrome.visible.value).toBe(true)
    expect(chrome.topbar.value).toBe(false)
    expect(useSidebar().collapsed.value).toBe(true)
  })

  it('show() puts back the width the rail collapsed', () => {
    const chrome = useChrome()
    chrome.rail()
    chrome.show()
    expect(chrome.topbar.value).toBe(true)
    expect(useSidebar().collapsed.value).toBe(false)
  })

  it('the collapse toggle expands out of the rail rather than fighting it', () => {
    // The chevron in the rail points outward, so clicking it has to actually leave rail mode -
    // flipping the user's own width underneath a still-active rail would do nothing visible.
    const chrome = useChrome()
    chrome.rail()
    useSidebar().toggle()
    expect(useSidebar().collapsed.value).toBe(false)
    chrome.show()
    expect(useSidebar().collapsed.value).toBe(false)
  })

  it('reading the sidebar state does not disturb the rail', () => {
    // useSidebar() re-runs its width watcher on every call, so a rail written into the user's own
    // collapsed ref would be clobbered by the next call site that happens to invoke the composable.
    const chrome = useChrome()
    chrome.rail()
    useSidebar()
    useSidebar()
    expect(useSidebar().collapsed.value).toBe(true)
  })
})
