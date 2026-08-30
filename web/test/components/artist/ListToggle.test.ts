import { mountSuspended } from '@nuxt/test-utils/runtime'
import { LayoutGrid, LayoutList } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'
import ListToggle from '../../../components/artist/ListToggle.vue'

const OPTIONS = [
  { value: 'expanded', icon: LayoutGrid, title: 'Grid view' },
  { value: 'summarized', icon: LayoutList, title: 'List view' },
]

describe('artist/ListToggle.vue', () => {
  it('marks the active option with aria-checked and roving tabindex', async () => {
    const wrapper = await mountSuspended(ListToggle, { props: { options: OPTIONS, modelValue: 'expanded' } })
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios[0]!.attributes('aria-checked')).toBe('true')
    expect(radios[0]!.attributes('tabindex')).toBe('0')
    expect(radios[1]!.attributes('aria-checked')).toBe('false')
    expect(radios[1]!.attributes('tabindex')).toBe('-1')
  })

  it('clicking an option updates the model', async () => {
    const wrapper = await mountSuspended(ListToggle, { props: { options: OPTIONS, modelValue: 'expanded' } })
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['summarized']])
  })

  it('gives each option an accessible name via title/aria-label', async () => {
    const wrapper = await mountSuspended(ListToggle, { props: { options: OPTIONS, modelValue: 'expanded' } })
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios[0]!.attributes('aria-label')).toBe('Grid view')
    expect(radios[1]!.attributes('aria-label')).toBe('List view')
  })
})
