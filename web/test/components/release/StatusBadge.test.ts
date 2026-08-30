import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import StatusBadge from '../../../components/release/StatusBadge.vue'
import { getStatus } from '../../../helpers/constants'
import { toneBg } from '../../../helpers/ui'
import type { ReleaseStatus } from '../../../types/release'

describe('release/StatusBadge.vue', () => {
  it.each(['COMPLETE', 'MISSING_TRACKS', 'MISSING', 'UNMATCHED'] as ReleaseStatus[])('renders the label and tone classes for %s from the shared status map', async (status) => {
    const wrapper = await mountSuspended(StatusBadge, { props: { status } })
    const expected = getStatus(status)
    expect(wrapper.text()).toBe(expected.label)
    const rendered = wrapper.get('span').classes()
    for (const cls of toneBg[expected.tone].split(' ')) {
      expect(rendered).toContain(cls)
    }
  })
})
