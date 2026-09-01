import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QueueContent from '../../../components/downloads/QueueContent.vue'
import Subtabs from '../../../components/Subtabs.vue'
import { useDownloadsStore } from '../../../stores/downloads'
import type { DownloadedReleaseItem } from '../../../types/download'

const item = (id: string, status: string, title = id): DownloadedReleaseItem => ({
  id,
  artist: 'Radiohead',
  artistSlug: 'radiohead',
  title,
  year: 2007,
  source: 'SLSKD',
  slskUsername: null,
  torrentHash: null,
  quality: 'FLAC',
  status,
  attempts: 1,
  error: null,
  stagingPath: null,
  mbReleaseId: null,
  releaseGroupId: null,
  localReleaseId: null,
  releaseType: 'Album',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  percent: 42,
} as unknown as DownloadedReleaseItem)

const ACTIVE = [
  item('d1', 'DOWNLOADING', 'In Rainbows'),
  item('d2', 'ENRICHING', 'Kid A'),
  item('f1', 'FAILED', 'Amnesiac'),
  item('f2', 'ABANDONED', 'Hail to the Thief'),
  item('u1', 'UNAVAILABLE', 'The Bends'),
]
const REJECTED = [item('r1', 'REJECTED', 'Pablo Honey')]

// mountSuspended reuses one Nuxt app (and its Pinia instance) for the whole file, and mounting is what
// makes that instance active - so the store is seeded after the mount, and reset afterwards.
let activeStore: ReturnType<typeof useDownloadsStore> | undefined

const mountQueue = async () => {
  const wrapper = await mountSuspended(QueueContent)
  const store = useDownloadsStore()
  activeStore = store
  store.queueActive = [...ACTIVE]
  store.queueRejected = [...REJECTED]
  await flushPromises()
  return wrapper
}

const subtabs = (wrapper: any) => wrapper.findComponent(Subtabs).props('tabs')
const rowTitles = (wrapper: any) => wrapper.findAll('tbody tr').map((r: any) => r.text())
const setFilter = async (wrapper: any, key: string) => {
  wrapper.findComponent(Subtabs).vm.$emit('update:modelValue', key)
  await flushPromises()
}

// The four sibling pages (downloading/failed/unavailable/rejected) are one tab now: same table, same
// search, same bulk bar - only the visible slice and the available actions change.
describe('downloads/QueueContent.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn())
  })

  afterEach(() => {
    if (activeStore) {
      activeStore.queueActive = []
      activeStore.queueRejected = []
    }
  })

  it('holds every non-ready queue row, counted per subtab', async () => {
    const wrapper = await mountQueue()
    expect(subtabs(wrapper).map((t: any) => [t.key, t.count])).toEqual([
      ['all', 6],
      ['downloading', 2],
      ['failed', 2],
      ['unavailable', 1],
      ['rejected', 1],
    ])
    expect(rowTitles(wrapper)).toHaveLength(6)
  })

  it('narrows the table to the picked slice', async () => {
    const wrapper = await mountQueue()
    await setFilter(wrapper, 'failed')
    const titles = rowTitles(wrapper)
    expect(titles).toHaveLength(2)
    expect(titles.join(' ')).toContain('Amnesiac')
    expect(titles.join(' ')).not.toContain('In Rainbows')
  })

  it('derives the header bulk buttons from what is on screen, not from a hardcoded page', async () => {
    const wrapper = await mountQueue()
    const labels = () => wrapper.findAll('button').map((b: any) => b.text())

    await setFilter(wrapper, 'downloading')
    expect(labels().some((t: string) => t.startsWith('Reject all'))).toBe(false)
    expect(labels().some((t: string) => t.startsWith('Move all back'))).toBe(false)

    await setFilter(wrapper, 'failed')
    expect(labels().some((t: string) => t.includes('Reject all (2)'))).toBe(true)

    await setFilter(wrapper, 'rejected')
    expect(labels().some((t: string) => t.includes('Move all back to queue (1)'))).toBe(true)
    expect(labels().some((t: string) => t.startsWith('Reject all'))).toBe(false)
  })

  it('explains the unavailable slice only while it is showing', async () => {
    const wrapper = await mountQueue()
    expect(wrapper.text()).not.toContain('No Soulseek source found yet')
    await setFilter(wrapper, 'unavailable')
    expect(wrapper.text()).toContain('No Soulseek source found yet')
  })

  it('drops the selection when the slice changes, so a bulk action never hits hidden rows', async () => {
    const wrapper = await mountQueue()
    await setFilter(wrapper, 'failed')
    const rowBox = wrapper.find('tbody tr input[type="checkbox"]').element as HTMLInputElement
    rowBox.checked = true
    rowBox.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(wrapper.text()).toContain('selected')

    await setFilter(wrapper, 'rejected')
    expect(wrapper.text()).not.toContain('selected')
  })
})
