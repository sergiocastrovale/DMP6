import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import LoadingBlock from '../../../components/ui/LoadingBlock.vue'

describe('ui/LoadingBlock.vue', () => {
  it('announces itself to assistive tech via role=status', async () => {
    const wrapper = await mountSuspended(LoadingBlock)
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-live')).toBe('polite')
  })

  it('falls back to a screen-reader-only label with no label prop', async () => {
    const wrapper = await mountSuspended(LoadingBlock)
    expect(wrapper.find('.sr-only').text()).toBe('Loading…')
  })

  it('renders a visible label when provided', async () => {
    const wrapper = await mountSuspended(LoadingBlock, { props: { label: 'Loading genre data...' } })
    expect(wrapper.text()).toContain('Loading genre data...')
  })

  it('defaults to page padding', async () => {
    const wrapper = await mountSuspended(LoadingBlock)
    expect(wrapper.classes()).toContain('py-20')
  })

  it('uses tighter padding for the inline size', async () => {
    const wrapper = await mountSuspended(LoadingBlock, { props: { size: 'inline' } })
    expect(wrapper.classes()).toContain('py-8')
  })
})
