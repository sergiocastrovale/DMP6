import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import LabsIndex from '../../../pages/labs/index.vue'
import { useGlobalStore } from '../../../stores/global'

const mountLabs = async () => {
  const wrapper = await mountSuspended(LabsIndex)
  return { wrapper, global: useGlobalStore() }
}

describe('pages/labs/index.vue', () => {
  it('states how much to trust each experiment', async () => {
    // A force graph you can drag into a knot and a mosaic that has run over the whole library are
    // not the same promise; the card is the only place that shows before you click.
    const { wrapper } = await mountLabs()
    const text = wrapper.text()
    expect(text).toContain('Stable')
    expect(text).toContain('Beta')
    expect(text).toContain('Experimental')
  })

  it('lists the five experiments', async () => {
    const { wrapper } = await mountLabs()
    for (const title of ['Album Mosaic', 'World Map', 'Genre Genome', 'Decade DNA', 'Artist Network']) {
      expect(wrapper.text()).toContain(title)
    }
    expect(wrapper.findAll('a')).toHaveLength(5)
  })

  it('quotes the live library size in the mosaic description', async () => {
    const { wrapper, global } = await mountLabs()
    global.stats.releases = 142140
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('142,140 covers')
  })
})
