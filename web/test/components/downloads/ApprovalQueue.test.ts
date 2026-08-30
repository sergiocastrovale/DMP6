import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ApprovalQueue from '../../../components/downloads/ApprovalQueue.vue'
import type { DownloadedReleaseItem } from '../../../types/download'

const item = (overrides: Partial<DownloadedReleaseItem>): DownloadedReleaseItem => ({
  id: 'd1',
  artist: 'Radiohead',
  artistSlug: 'radiohead',
  title: 'In Rainbows',
  year: 2007,
  source: 'SLSKD',
  slskUsername: null,
  torrentHash: null,
  quality: 'FLAC',
  status: 'DOWNLOADING',
  error: null,
  stagingPath: null,
  mbReleaseId: null,
  releaseGroupId: null,
  localReleaseId: null,
  releaseType: 'Album',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  percent: 42,
  ...overrides,
} as DownloadedReleaseItem)

describe('downloads/ApprovalQueue.vue', () => {
  it('shows the empty state when there are no items', async () => {
    const wrapper = await mountSuspended(ApprovalQueue, { props: { items: [] } })
    expect(wrapper.text()).toContain('Nothing here.')
  })

  it('renders a row per item with artist link and title', async () => {
    const wrapper = await mountSuspended(ApprovalQueue, { props: { items: [item({})] } })
    const link = wrapper.get('a')
    expect(link.text()).toBe('Radiohead')
    expect(link.attributes('href')).toBe('/artist/radiohead')
    expect(wrapper.text()).toContain('In Rainbows')
  })

  it('gives DOWNLOADING the same accent tone as its progress bar, not the old contradicting blue', async () => {
    const wrapper = await mountSuspended(ApprovalQueue, { props: { items: [item({ status: 'DOWNLOADING' })] } })
    const statusSpan = wrapper.findAll('span').find(s => s.text().includes('downloading'))!
    expect(statusSpan.classes()).toContain('text-amber-400')
    expect(statusSpan.classes().join(' ')).not.toContain('blue')
  })

  it('selecting a row emits an updated selected set', async () => {
    const wrapper = await mountSuspended(ApprovalQueue, {
      props: { items: [item({ id: 'd1' })], selectable: true },
    })
    const checkbox = wrapper.get('[aria-label="Select In Rainbows"] input').element as HTMLInputElement
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:selected')![0]![0]).toEqual(new Set(['d1']))
  })

  it('clicking a sortable header sorts the rows', async () => {
    const items = [item({ id: 'a', title: 'Zeta' }), item({ id: 'b', title: 'Alpha' })]
    const wrapper = await mountSuspended(ApprovalQueue, { props: { items } })
    const releaseHeader = wrapper.findAll('th').find(th => th.text().includes('Release'))!
    await releaseHeader.get('button').trigger('click')
    const titles = wrapper.findAll('tbody tr').map(tr => tr.text())
    expect(titles[0]).toContain('Alpha')
  })

  it('only shows the reject action when showActions is set', async () => {
    const withActions = await mountSuspended(ApprovalQueue, { props: { items: [item({})], showActions: true } })
    expect(withActions.find('[aria-label="Reject"]').exists()).toBe(true)

    const withoutActions = await mountSuspended(ApprovalQueue, { props: { items: [item({})], showActions: false } })
    expect(withoutActions.find('[aria-label="Reject"]').exists()).toBe(false)
  })

  it('emits reject with the row id when the reject action is clicked', async () => {
    const wrapper = await mountSuspended(ApprovalQueue, { props: { items: [item({ id: 'd1', status: 'FAILED' })], showActions: true } })
    await wrapper.get('[aria-label="Reject"]').trigger('click')
    expect(wrapper.emitted('reject')).toEqual([['d1']])
  })
})
