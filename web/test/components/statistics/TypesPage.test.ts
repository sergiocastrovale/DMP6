import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TypesPage from '../../../components/statistics/TypesPage.vue'

const PAGE = {
  items: [{ id: 'a1', name: 'Radiohead', slug: 'radiohead', album: 9, ep: 2, live: 0, soundtrack: 0, single: 1, compilation: 0, 'box-set': 0, unknown: 0 }],
  total: 1,
  hasMore: false,
}

describe('statistics/TypesPage.vue', () => {
  beforeEach(() => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(PAGE))
  })

  it('renders one column per bucket, dims zero counts, and has no actions column', async () => {
    const wrapper = await mountSuspended(TypesPage)
    await flushPromises()

    expect(wrapper.findAll('th').some(th => th.text().includes('Albums'))).toBe(true)
    expect(wrapper.findAll('th').some(th => th.text().includes('Box'))).toBe(true)
    expect(wrapper.findAll('th').some(th => th.text() === 'Actions')).toBe(false)

    expect(wrapper.text()).toContain('Radiohead')
    const row = wrapper.findAll('tr').find(tr => tr.text().includes('Radiohead'))!
    const cells = row.findAll('td')
    expect(cells[1]!.text()).toBe('9') // album count, non-zero -> a link
    expect(cells[1]!.find('a').exists()).toBe(true)
    expect(cells[3]!.text()).toBe('0') // live count, zero -> dimmed plain text, no link
    expect(cells[3]!.find('a').exists()).toBe(false)
    expect(cells[3]!.find('span').classes()).toContain('text-stone-100/25')
  })

  it('makes the whole row a link to the artist page, not just a cell', async () => {
    const wrapper = await mountSuspended(TypesPage)
    await flushPromises()
    const row = wrapper.findAll('tr').find(tr => tr.text().includes('Radiohead'))!
    expect(row.attributes('role')).toBe('link')
  })

  it('links a nonzero count to the type-detail page for that artist and bucket', async () => {
    const wrapper = await mountSuspended(TypesPage)
    await flushPromises()
    const row = wrapper.findAll('tr').find(tr => tr.text().includes('Radiohead'))!
    const albumLink = row.findAll('a').find(a => a.text() === '9')!
    expect(albumLink.attributes('href')).toBe('/statistics/types/album?artist=radiohead&name=Radiohead')
  })

  it('links the artist name to their artist page', async () => {
    const wrapper = await mountSuspended(TypesPage)
    await flushPromises()
    const row = wrapper.findAll('tr').find(tr => tr.text().includes('Radiohead'))!
    const nameLink = row.findAll('a').find(a => a.text() === 'Radiohead')!
    expect(nameLink.attributes('href')).toBe('/artist/radiohead')
  })
})
