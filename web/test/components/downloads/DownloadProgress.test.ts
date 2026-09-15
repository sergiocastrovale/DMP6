import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DownloadProgress from '../../../components/downloads/DownloadProgress.vue'

describe('downloads/DownloadProgress.vue', () => {
  it('single mode: renders one release percent with no label', async () => {
    const wrapper = await mountSuspended(DownloadProgress, { props: { percent: 42, status: 'DOWNLOADING' } })
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('42')
    expect(wrapper.text()).not.toContain('%42')
  })

  it('items-aggregate mode: derives a percent and label from bytes across items', async () => {
    const wrapper = await mountSuspended(DownloadProgress, {
      props: {
        items: [
          { status: 'DOWNLOADING', percent: 50, bytesTransferred: 50, totalBytes: 100 },
          { status: 'DOWNLOADING', percent: 50, bytesTransferred: 50, totalBytes: 100 },
        ],
      },
    })
    expect(wrapper.text()).toContain('Downloading 2 releases')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50')
  })

  it('labelled mode: renders a precomputed label/percent directly (e.g. merge progress), ignored when items is set', async () => {
    const wrapper = await mountSuspended(DownloadProgress, {
      props: { label: 'Merging 12 releases — 4/12 done', percent: 33 },
    })
    expect(wrapper.text()).toContain('Merging 12 releases — 4/12 done')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('33')
  })
})
