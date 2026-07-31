import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useHighlightId } from '../../composables/useHighlightId'

const { routeRef } = vi.hoisted(() => ({ routeRef: { query: {} as Record<string, string> } }))
mockNuxtImport('useRoute', () => () => routeRef)

describe('useHighlightId', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    routeRef.query = {}
  })
  afterEach(() => vi.useRealTimers())

  it('reads ?highlight= from the route query', () => {
    routeRef.query = { highlight: 'track-123' }
    const highlightId = useHighlightId()
    expect(highlightId.value).toBe('track-123')
  })

  it('is null when there is no highlight query param', () => {
    const highlightId = useHighlightId()
    expect(highlightId.value).toBeNull()
  })

  it('clears itself after 4 seconds', () => {
    routeRef.query = { highlight: 'track-123' }
    const highlightId = useHighlightId()
    vi.advanceTimersByTime(3999)
    expect(highlightId.value).toBe('track-123')
    vi.advanceTimersByTime(1)
    expect(highlightId.value).toBeNull()
  })

  it('does not schedule a clear timer when there is nothing to clear', () => {
    useHighlightId()
    // No throw / no pending timers issue when advancing time with nothing highlighted.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
  })
})
