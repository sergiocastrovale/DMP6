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

  it.each([
    ['SEARCHING', 'text-stone-100/55'],
    ['UNAVAILABLE', 'text-warning'],
    ['INVALID', 'text-danger'],
    ['REJECTED', 'text-stone-100/55'],
    ['READY', 'text-success'],
  ])('tones %s as %s', async (status, expected) => {
    // "No source found yet, retried automatically" is a warning rather than a shrug, and an invalid
    // merge is a failure the same way a failed download is - both used to render as muted grey.
    const wrapper = await mountSuspended(ApprovalQueue, { props: { items: [item({ status: status as any })] } })
    const statusSpan = wrapper.findAll('span').find(s => s.text().includes(status.toLowerCase()))!
    expect(statusSpan.classes()).toContain(expected)
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

  // `auto` is what lets the merged Queue tab hold downloading, failed, unavailable and rejected rows in
  // one table: the four pages that used to hardcode their own action set are gone, so each row has to
  // decide for itself.
  describe('auto mode derives the actions from each row status', () => {
    const actions = async (status: string) => {
      const wrapper = await mountSuspended(ApprovalQueue, { props: { items: [item({ status: status as any })], auto: true } })
      return {
        retry: wrapper.find('[aria-label="Force retry"]').exists(),
        reject: wrapper.find('[aria-label="Reject"]').exists(),
        cancel: wrapper.find('[aria-label="Cancel download"]').exists(),
        requeue: wrapper.find('[aria-label="Move back to queue"]').exists(),
      }
    }

    it.each(['FAILED', 'ABANDONED', 'UNAVAILABLE'])('offers retry + reject on %s', async (status) => {
      expect(await actions(status)).toEqual({ retry: true, reject: true, cancel: false, requeue: false })
    })

    it.each(['SEARCHING', 'DOWNLOADING', 'ENRICHING'])('offers only cancel on %s', async (status) => {
      expect(await actions(status)).toEqual({ retry: false, reject: false, cancel: true, requeue: false })
    })

    it('offers only "move back to queue" on REJECTED', async () => {
      expect(await actions('REJECTED')).toEqual({ retry: false, reject: false, cancel: false, requeue: true })
    })

    it('mixes the action sets within one table', async () => {
      const wrapper = await mountSuspended(ApprovalQueue, {
        props: {
          items: [item({ id: 'a', status: 'DOWNLOADING' }), item({ id: 'b', status: 'FAILED' }), item({ id: 'c', status: 'REJECTED' })],
          auto: true,
        },
      })
      const rows = wrapper.findAll('tbody tr')
      expect(rows[0]!.find('[aria-label="Cancel download"]').exists()).toBe(true)
      expect(rows[1]!.find('[aria-label="Force retry"]').exists()).toBe(true)
      expect(rows[2]!.find('[aria-label="Move back to queue"]').exists()).toBe(true)
    })
  })
})
