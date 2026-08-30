import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatPage from '../../../components/statistics/StatPage.vue'
import type { DataTableColumn } from '../../../components/DataTable.vue'

const COLUMNS: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'year', label: 'Year', sortable: true, align: 'right' },
]

const PAGE = { items: [{ id: 'r1', title: 'OK Computer', year: 1997 }], total: 1, hasMore: false }

describe('statistics/StatPage.vue', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(PAGE)
    vi.stubGlobal('$fetch', fetchMock)
  })

  it('fetches on mount and renders rows through DataTable', async () => {
    const wrapper = await mountSuspended(StatPage, {
      props: { title: 'Releases', apiType: 'releases', label: 'releases', columns: COLUMNS },
    })
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/stats/releases', expect.objectContaining({
      query: expect.objectContaining({ page: 1, sort: undefined, order: 'asc' }),
    }))
    expect(wrapper.text()).toContain('OK Computer')
    expect(wrapper.text()).toContain('1 releases')
  })

  it('forwards a cell slot down to DataTable', async () => {
    const wrapper = await mountSuspended(StatPage, {
      props: { title: 'Releases', apiType: 'releases', label: 'releases', columns: COLUMNS },
      slots: {
        'cell-title': `<template #cell-title="{ row }"><a :href="'/x/' + row.id">{{ row.title }}</a></template>`,
      },
    })
    await flushPromises()
    const link = wrapper.findAll('a').find(a => a.attributes('href')?.startsWith('/x/'))!
    expect(link.attributes('href')).toBe('/x/r1')
    expect(link.text()).toBe('OK Computer')
  })

  it('re-fetches from page 1 with the search term on search', async () => {
    const wrapper = await mountSuspended(StatPage, {
      props: { title: 'Releases', apiType: 'releases', label: 'releases', columns: COLUMNS },
    })
    await flushPromises()
    fetchMock.mockClear()
    await wrapper.get('input').setValue('computer')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/stats/releases', expect.objectContaining({
      query: expect.objectContaining({ page: 1, search: 'computer' }),
    }))
  })

  it('clicking a sortable header sorts ascending then descending on the same column', async () => {
    const wrapper = await mountSuspended(StatPage, {
      props: { title: 'Releases', apiType: 'releases', label: 'releases', columns: COLUMNS, defaultSort: '' },
    })
    await flushPromises()
    fetchMock.mockClear()
    const yearHeader = wrapper.findAll('th').find(th => th.text().includes('Year'))!
    await yearHeader.get('button').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/stats/releases', expect.objectContaining({
      query: expect.objectContaining({ sort: 'year', order: 'asc' }),
    }))
    await yearHeader.get('button').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/stats/releases', expect.objectContaining({
      query: expect.objectContaining({ sort: 'year', order: 'desc' }),
    }))
  })

  it('shows a label-specific empty message when there are no results', async () => {
    fetchMock.mockResolvedValue({ items: [], total: 0, hasMore: false })
    const wrapper = await mountSuspended(StatPage, {
      props: { title: 'Releases', apiType: 'releases', label: 'releases', columns: COLUMNS },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No releases found')
  })
})
