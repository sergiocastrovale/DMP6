import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import History from '../../../components/explore/History.vue'
import { EXPLORE_HISTORY_PAGE_SIZE } from '../../../helpers/constants'
import type { TestButtons } from '../../../types/common'

const tracks = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: `t${i}`, title: `Track ${i}`, artist: 'Artist', album: 'Album', duration: 200,
  artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1',
})) as any

const rows = (wrapper: { findAll: (selector: string) => any[] }): any[] => {
  // Find the track row divs (the main container for each track)
  const allDivs = wrapper.findAll('div')
  const trackRows = allDivs.filter(div => {
    const classes = div.attributes('class') || ''
    return classes.includes('flex items-center gap-3')
  })
  // Get the first button (thumbnail) from each row
  return trackRows.map(row => row.findAll('button')[0]).filter(Boolean)
}

describe('explore/History.vue', () => {
  it('shows at most one page of rows', async () => {
    const wrapper = await mountSuspended(History, { props: { tracks: tracks(40) } })
    expect(rows(wrapper)).toHaveLength(EXPLORE_HISTORY_PAGE_SIZE)
    expect(wrapper.text()).toContain('Track 0')
    expect(wrapper.text()).not.toContain('Track 20')
  })

  it('hides the arrows when everything fits on one page', async () => {
    const wrapper = await mountSuspended(History, { props: { tracks: tracks(EXPLORE_HISTORY_PAGE_SIZE) } })
    expect(wrapper.findAll('button[aria-label="Older tracks"]')).toHaveLength(0)
  })

  it('pages back through older entries and disables the arrows at each end', async () => {
    const wrapper = await mountSuspended(History, { props: { tracks: tracks(40) } })
    const older = wrapper.get('button[aria-label="Older tracks"]')
    const newer = wrapper.get('button[aria-label="Newer tracks"]')
    expect(newer.attributes('disabled')).toBeDefined()

    await older.trigger('click')
    expect(wrapper.text()).toContain('Track 15')
    expect(wrapper.text()).not.toContain('Track 0')
    expect(newer.attributes('disabled')).toBeUndefined()

    await older.trigger('click')
    expect(older.attributes('disabled')).toBeDefined()

    await newer.trigger('click')
    expect(wrapper.text()).toContain('Track 15')
  })

  it('clamps the page when the list shrinks under it', async () => {
    const wrapper = await mountSuspended(History, { props: { tracks: tracks(40) } })
    await wrapper.get('button[aria-label="Older tracks"]').trigger('click')
    await wrapper.get('button[aria-label="Older tracks"]').trigger('click')
    await wrapper.setProps({ tracks: tracks(10) })
    expect(rows(wrapper)).toHaveLength(10)
    expect(wrapper.text()).toContain('Track 0')
  })

  it('emits play with the clicked track', async () => {
    const wrapper = await mountSuspended(History, { props: { tracks: tracks(3) } })
    await rows(wrapper)[1]!.trigger('click')
    expect(wrapper.emitted('play')?.[0]?.[0]).toMatchObject({ id: 't1' })
  })

  it('puts the artist and year on their own line under the title', async () => {
    const withYear = [{ ...tracks(1)[0], year: 1976 }]
    const wrapper = await mountSuspended(History, { props: { tracks: withYear as any } })
    expect(wrapper.text()).toContain('Track 0')
    expect(wrapper.text()).toContain('Artist · 1976')
  })

  it('omits the year segment for a track that has none, rather than printing a dangling dot', async () => {
    // Only the explore endpoint fills `year` in; every other queue source leaves it undefined.
    const wrapper = await mountSuspended(History, { props: { tracks: tracks(1) } })
    expect(wrapper.text()).toContain('Artist')
    expect(wrapper.text()).not.toContain('Artist ·')
  })
})
