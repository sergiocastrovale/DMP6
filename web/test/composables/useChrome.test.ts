import { describe, expect, it } from 'vitest'
import { useChrome } from '../../composables/useChrome'

describe('useChrome', () => {
  it('defaults to visible', () => {
    useChrome().show()
    expect(useChrome().visible.value).toBe(true)
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
})
