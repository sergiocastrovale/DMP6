import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ButtonRemove from '../../../components/artist/ButtonRemove.vue'

describe('artist/ButtonRemove.vue', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => { document.body.innerHTML = '' })

  it('renders a Remove button', async () => {
    const wrapper = await mountSuspended(ButtonRemove, { props: { artistName: 'Air Supply' } })
    expect(wrapper.text()).toContain('Remove')
  })

  it('opens the delete dialog on click', async () => {
    // DeleteDialog renders through Dialog.vue's <Teleport to="body">, outside the wrapper's subtree.
    const wrapper = await mountSuspended(ButtonRemove, { props: { artistName: 'Air Supply' } })

    expect(document.body.textContent).not.toContain('Remove artist')
    await wrapper.get('button').trigger('click')
    expect(document.body.textContent).toContain('Remove artist')
  })
})
