import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import DataTable from '../../components/DataTable.vue'
import type { DataTableColumn } from '../../components/DataTable.vue'

interface Artist {
  id: string
  name: string
  releases: number
}

const ROWS: Artist[] = [
  { id: 'a', name: 'Radiohead', releases: 12 },
  { id: 'b', name: 'Boards of Canada', releases: 4 },
]

const COLUMNS: DataTableColumn[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'releases', label: 'Releases', align: 'right' },
]

describe('DataTable.vue', () => {
  it('renders one row per item and one cell per column', async () => {
    const wrapper = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS } })
    expect(wrapper.text()).toContain('Radiohead')
    expect(wrapper.text()).toContain('Boards of Canada')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })

  it('shows a loading skeleton instead of rows while loading', async () => {
    const wrapper = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS, loading: true, loadingRows: 3 } })
    expect(wrapper.text()).not.toContain('Radiohead')
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
  })

  it('shows the empty state with a message and hint when there are no rows', async () => {
    const wrapper = await mountSuspended(DataTable, {
      props: { columns: COLUMNS, rows: [], emptyMessage: 'No artists found.', emptyHint: 'Try a different filter.' },
    })
    expect(wrapper.text()).toContain('No artists found.')
    expect(wrapper.text()).toContain('Try a different filter.')
  })

  it('marks the active sort column with aria-sort and toggles direction via emitted sort key', async () => {
    const wrapper = await mountSuspended(DataTable, {
      props: { columns: COLUMNS, rows: ROWS, sort: { key: 'name', dir: 'asc' } },
    })
    const nameHeader = wrapper.findAll('th').find(th => th.text().includes('Name'))!
    expect(nameHeader.attributes('aria-sort')).toBe('ascending')
    await nameHeader.get('button').trigger('click')
    expect(wrapper.emitted('sort')).toEqual([['name']])
  })

  it('a non-sortable column renders a plain header with no aria-sort', async () => {
    const wrapper = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS } })
    const releasesHeader = wrapper.findAll('th').find(th => th.text().includes('Releases'))!
    expect(releasesHeader.attributes('aria-sort')).toBeUndefined()
    expect(releasesHeader.find('button').exists()).toBe(false)
  })

  // Checkbox.vue's aria-label lands on its root <label>, and a native label-click forwards to
  // its wrapped <input> in a real browser - happy-dom doesn't simulate that forwarding, so tests
  // trigger `change` on the input itself, exactly as a real click-then-toggle would.
  const checkInput = (input: HTMLInputElement, checked: boolean) => {
    input.checked = checked
    input.dispatchEvent(new Event('change'))
  }

  it('selecting all rows emits every row id', async () => {
    const wrapper = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS } })
    const selectAll = wrapper.get('[aria-label="Select all rows"] input').element as HTMLInputElement
    checkInput(selectAll, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:selected')![0]![0]).toEqual(new Set(['a', 'b']))
  })

  it('selecting a single row emits a set containing just that row', async () => {
    const wrapper = await mountSuspended(DataTable, {
      // Vue's generic <script setup> components don't carry their type parameter through when
      // mounted directly (as opposed to used in a template), so TS can't unify T with Artist
      // here - a test-only cast, not something app code needs to do.
      props: { columns: COLUMNS, rows: ROWS, rowLabel: ((row: Artist) => row.name) as (row: object) => string },
    })
    const radioheadCheckbox = wrapper.get('[aria-label="Select Radiohead"] input').element as HTMLInputElement
    checkInput(radioheadCheckbox, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:selected')![0]![0]).toEqual(new Set(['a']))
  })

  it('falls back to a generic row label when rowLabel is not provided', async () => {
    const wrapper = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS } })
    expect(wrapper.find('[aria-label="Select row a"]').exists()).toBe(true)
  })

  it('the header checkbox is indeterminate when some but not all rows are selected', async () => {
    const wrapper = await mountSuspended(DataTable, {
      props: { columns: COLUMNS, rows: ROWS, selected: new Set(['a']) },
    })
    const headerCheckbox = wrapper.get('[aria-label="Select all rows"] input')
    expect((headerCheckbox.element as HTMLInputElement).indeterminate).toBe(true)
  })

  it('shows the bulk-action bar with a selection count once something is selected', async () => {
    const wrapper = await mountSuspended(DataTable, {
      props: { columns: COLUMNS, rows: ROWS, selected: new Set(['a']) },
    })
    expect(wrapper.text()).toContain('1 selected')
  })

  it('runs a bulk action with the selected rows and Cancel clears the selection', async () => {
    const onClick = vi.fn()
    const wrapper = await mountSuspended(DataTable, {
      props: {
        columns: COLUMNS,
        rows: ROWS,
        selected: new Set(['a']),
        bulkActions: [{ key: 'delete', label: 'Delete', onClick }],
      },
    })
    const deleteButton = wrapper.findAll('button').find(b => b.text().includes('Delete'))!
    await deleteButton.trigger('click')
    expect(onClick).toHaveBeenCalledWith([ROWS[0]])

    const cancelButton = wrapper.findAll('button').find(b => b.text() === 'Cancel')!
    await cancelButton.trigger('click')
    expect(wrapper.emitted('update:selected')!.at(-1)![0]).toEqual(new Set())
  })

  it('renders a custom cell slot when provided, otherwise the raw value', async () => {
    const wrapper = await mountSuspended(DataTable, {
      props: { columns: COLUMNS, rows: ROWS },
      slots: {
        'cell-name': `<template #cell-name="{ row }"><strong>{{ row.name.toUpperCase() }}</strong></template>`,
      },
    })
    expect(wrapper.html()).toContain('RADIOHEAD')
  })

  it('renders the actions slot and an Actions header only when the slot is provided', async () => {
    const withoutActions = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS } })
    expect(withoutActions.text()).not.toContain('Actions')

    const withActions = await mountSuspended(DataTable, {
      props: { columns: COLUMNS, rows: ROWS },
      slots: { actions: `<template #actions="{ row }"><button>Open {{ row.name }}</button></template>` },
    })
    expect(withActions.text()).toContain('Actions')
    expect(withActions.text()).toContain('Open Radiohead')
  })
})

describe('DataTable.vue column class passthrough', () => {
  it('applies a column class to both header and cells for responsive hiding', async () => {
    const columns: DataTableColumn[] = [
      { key: 'name', label: 'Name', sortable: true, class: 'hidden md:table-cell' },
      { key: 'releases', label: 'Releases', align: 'right' },
    ]
    const wrapper = await mountSuspended(DataTable, { props: { columns, rows: ROWS } })
    const nameHeader = wrapper.findAll('th').find(th => th.text().includes('Name'))!
    expect(nameHeader.classes()).toEqual(expect.arrayContaining(['hidden', 'md:table-cell']))
    const nameCell = wrapper.findAll('td').find(td => td.text().includes('Radiohead'))!
    expect(nameCell.classes()).toEqual(expect.arrayContaining(['hidden', 'md:table-cell']))
  })

  it('gives a right-aligned default cell tabular-nums', async () => {
    const wrapper = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS } })
    const cell = wrapper.findAll('td').find(td => td.text() === '12')!
    expect(cell.find('span').classes()).toContain('tabular-nums')
  })

  it('hides selection entirely when selectable is false', async () => {
    const wrapper = await mountSuspended(DataTable, { props: { columns: COLUMNS, rows: ROWS, selectable: false } })
    expect(wrapper.find('[aria-label="Select all rows"]').exists()).toBe(false)
  })
})
