import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import StatusChips from '../../../components/artist/StatusChips.vue'
import { statuses } from '../../../helpers/constants'

// The legend renders via <Teleport to="body">, so it lands outside the wrapper's own DOM subtree.
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('artist/StatusChips.vue', () => {
  it('renders one chip per status that has a non-zero count', async () => {
    wrapper = await mountSuspended(StatusChips, {
      props: {
        statusCounts: { COMPLETE: 6, MISSING: 2 },
        activeStatuses: new Set<string>(),
      },
    })
    expect(wrapper.text()).toContain('Complete')
    expect(wrapper.text()).toContain('Missing')
    expect(wrapper.text()).not.toContain('Extra tracks')
  })

  it('toggles a status into the active set on click', async () => {
    wrapper = await mountSuspended(StatusChips, {
      props: {
        statusCounts: { COMPLETE: 6 },
        activeStatuses: new Set<string>(),
      },
    })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update:activeStatuses')![0]![0]).toEqual(new Set(['COMPLETE']))
  })

  it('the legend lists every known status with its description on hover', async () => {
    wrapper = await mountSuspended(StatusChips, {
      props: { statusCounts: {}, activeStatuses: new Set<string>() },
    })
    // mouseenter doesn't bubble - the listener is on the wrapper div around the help button, not
    // the button itself.
    await wrapper.get('.relative').trigger('mouseenter')
    for (const status of statuses) {
      expect(document.body.textContent).toContain(status.description)
    }
  })
})
