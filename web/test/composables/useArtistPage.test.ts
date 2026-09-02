import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useArtistPage } from '../../composables/useArtistPage'

// The page's own $fetch calls (download-status, monitor PATCH); useFetch is mocked separately since
// artist/releases are SSR-fetched, not polled.
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const artist = ref<{ monitored: boolean } | null>({ monitored: false })

mockNuxtImport('useFetch', () => (url: any) => {
  const target = typeof url === 'function' ? url() : url
  return target.includes('/releases')
    ? { data: ref({ releases: [] }), pending: ref(false), error: ref(null), refresh: vi.fn() }
    : { data: artist, pending: ref(false), error: ref(null), refresh: vi.fn() }
})

const dlItem = (status: string) => ({
  mbReleaseId: 'mb1', status, downloadedReleaseId: 'dl1', percent: 0, bytesTransferred: 0, totalBytes: null,
})

const statusCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('download-status')).length

// Mounts the composable in a real component so onMounted/onUnmounted run.
const mountPage = async () => {
  const Host = defineComponent({
    setup: () => {
      const page = useArtistPage(ref('some-artist'))
      return () => h('div', String(page.pending.value))
    },
  })
  return mountSuspended(Host)
}

describe('useArtistPage download-status polling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ items: [] })
    artist.value = { monitored: false }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches once on mount and never polls while nothing is in flight', async () => {
    const wrapper = await mountPage()
    expect(statusCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(statusCalls()).toBe(1)
    wrapper.unmount()
  })

  it('polls every 2s while a row is transient, and stops once it goes terminal', async () => {
    fetchMock.mockResolvedValue({ items: [dlItem('DOWNLOADING')] })
    const wrapper = await mountPage()
    expect(statusCalls()).toBe(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(statusCalls()).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(statusCalls()).toBe(3)

    fetchMock.mockResolvedValue({ items: [dlItem('READY')] })
    await vi.advanceTimersByTimeAsync(2000) // the tick that observes READY
    const afterTerminal = statusCalls()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(statusCalls()).toBe(afterTerminal)
    wrapper.unmount()
  })

  it('keeps a 30s heartbeat for a monitored artist with nothing in flight', async () => {
    artist.value = { monitored: true }
    const wrapper = await mountPage()
    expect(statusCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(statusCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(28_000)
    expect(statusCalls()).toBe(2)
    wrapper.unmount()
  })

  it('stops polling on unmount', async () => {
    fetchMock.mockResolvedValue({ items: [dlItem('SEARCHING')] })
    const wrapper = await mountPage()
    await vi.advanceTimersByTimeAsync(2000)
    const before = statusCalls()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(statusCalls()).toBe(before)
  })
})
