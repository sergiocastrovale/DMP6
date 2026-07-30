import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

// Dialog.vue renders via <Teleport to="body">, so its content lands outside the mounted wrapper's own
// DOM subtree - query document.body directly rather than wrapper.text()/wrapper.find(...). Teleported
// nodes also outlive the wrapper unless explicitly unmounted, so each test unmounts its own instance.
const bodyButtons = () => [...document.body.querySelectorAll('button')]

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('ConfirmDialog.vue', () => {
  it('renders the title and message when open', async () => {
    wrapper = await mountSuspended(ConfirmDialog, {
      props: { modelValue: true, title: 'Delete release?', message: 'This cannot be undone.' },
    })
    expect(document.body.textContent).toContain('Delete release?')
    expect(document.body.textContent).toContain('This cannot be undone.')
  })

  it('does not render into the DOM when modelValue is false', async () => {
    wrapper = await mountSuspended(ConfirmDialog, {
      props: { modelValue: false, title: 'Hidden dialog' },
    })
    expect(document.body.textContent).not.toContain('Hidden dialog')
  })

  it('emits confirm when the confirm button is clicked', async () => {
    wrapper = await mountSuspended(ConfirmDialog, {
      props: { modelValue: true, title: 'Confirm', confirmLabel: 'Delete' },
    })
    const confirmBtn = bodyButtons().find(b => b.textContent?.trim() === 'Delete')
    await confirmBtn!.dispatchEvent(new Event('click'))
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('emits update:modelValue(false) when cancel is clicked', async () => {
    wrapper = await mountSuspended(ConfirmDialog, {
      props: { modelValue: true, title: 'Confirm' },
    })
    const cancelBtn = bodyButtons().find(b => b.textContent?.trim() === 'Cancel')
    await cancelBtn!.dispatchEvent(new Event('click'))
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('defaults confirmLabel to "Confirm" when not provided', async () => {
    wrapper = await mountSuspended(ConfirmDialog, {
      props: { modelValue: true, title: 'Some Title' },
    })
    const labels = bodyButtons().map(b => b.textContent?.trim())
    expect(labels).toContain('Confirm')
  })
})
