import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import BackLink from '../../../components/labs/BackLink.vue'

describe('labs/BackLink.vue', () => {
  it('links back to the Labs index', async () => {
    const wrapper = await mountSuspended(BackLink)
    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('/labs')
    expect(link.text()).toContain('Back to Labs')
  })
})
