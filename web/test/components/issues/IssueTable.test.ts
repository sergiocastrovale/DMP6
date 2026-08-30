import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import IssueTable from '../../../components/issues/IssueTable.vue'
import type { IssueColumn } from '../../../types/issues'

const COLUMNS: IssueColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist.name', label: 'Artist' },
]

const ITEMS = [
  { id: '1', title: 'Track A', artist: { name: 'Artist A' } },
  { id: '2', title: 'Track B', artist: { name: 'Artist B' } },
]

const baseProps = {
  type: 'missing' as const,
  columns: COLUMNS,
  items: ITEMS,
  total: 2,
  page: 1,
  pageSize: 50,
  loading: false,
  selected: new Set<string>(),
}

describe('issues/IssueTable.vue', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a row per item and the checkbox column for non-enrichment types', async () => {
    const wrapper = await mountSuspended(IssueTable, { props: baseProps })
    expect(wrapper.text()).toContain('Track A')
    expect(wrapper.text()).toContain('Artist A')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find('[aria-label="Select all rows"]').exists()).toBe(true)
  })

  it('hides selection for enrichment, which has no bulk fix', async () => {
    const wrapper = await mountSuspended(IssueTable, { props: { ...baseProps, type: 'enrichment' } })
    expect(wrapper.find('[aria-label="Select all rows"]').exists()).toBe(false)
  })

  it('selecting a row emits an updated selected set', async () => {
    const wrapper = await mountSuspended(IssueTable, { props: baseProps })
    const checkbox = wrapper.get('[aria-label="Select row 1"] input').element as HTMLInputElement
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:selected')![0]![0]).toEqual(new Set(['1']))
  })

  it('clicking a sortable header emits sort with the column key', async () => {
    const wrapper = await mountSuspended(IssueTable, { props: baseProps })
    await wrapper.get('th button').trigger('click')
    expect(wrapper.emitted('sort')).toEqual([['title']])
  })

  it('emits edit with the resolved key when an editable cell is committed', async () => {
    const columns: IssueColumn[] = [{ key: 'proposedValue', label: 'Proposed', editable: true, editKey: 'proposedValue' }]
    const items = [{ id: '1', proposedValue: 'Fixed Title' }]
    const wrapper = await mountSuspended(IssueTable, { props: { ...baseProps, columns, items } })
    await wrapper.get('span.cursor-pointer').trigger('click')
    const input = wrapper.get('input[autofocus]')
    await input.setValue('New Title')
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('edit')).toEqual([['1', 'proposedValue', 'New Title']])
  })

  it('warns in dev when a provided cell slot does not match any column key', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountSuspended(IssueTable, {
      props: baseProps,
      slots: { 'cell-artist_slug': '<template #cell-artist_slug>oops</template>' },
    })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cell-artist_slug'))
  })

  it('does not warn when every provided slot matches a column', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountSuspended(IssueTable, {
      props: baseProps,
      slots: { 'cell-artist_name': '<template #cell-artist_name="{ value }">{{ value }}</template>' },
    })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('shows the empty state when there are no items and not loading', async () => {
    const wrapper = await mountSuspended(IssueTable, { props: { ...baseProps, items: [], total: 0 } })
    expect(wrapper.text()).toContain('No issues found')
  })
})
