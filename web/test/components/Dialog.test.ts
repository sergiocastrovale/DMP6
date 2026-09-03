import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import Dialog from '../../components/Dialog.vue'

// Dialog.vue renders via <Teleport to="body">, so its content lands outside the mounted
// wrapper's own DOM subtree.
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('Dialog.vue', () => {
  it('renders nothing into the DOM when closed', async () => {
    wrapper = await mountSuspended(Dialog, { props: { modelValue: false, title: 'Hidden' } })
    expect(document.body.textContent).not.toContain('Hidden')
  })

  it('renders the title, subtitle and default slot when open', async () => {
    wrapper = await mountSuspended(Dialog, {
      props: { modelValue: true, title: 'Delete release?', subtitle: 'This cannot be undone.' },
      slots: { content: 'Body content' },
    })
    expect(document.body.textContent).toContain('Delete release?')
    expect(document.body.textContent).toContain('This cannot be undone.')
    expect(document.body.textContent).toContain('Body content')
  })

  it('carries the dialog role, aria-modal and a title-labelled panel', async () => {
    wrapper = await mountSuspended(Dialog, { props: { modelValue: true, title: 'Settings' } })
    const panel = document.body.querySelector('[role="dialog"]')!
    expect(panel.getAttribute('aria-modal')).toBe('true')
    const labelledBy = panel.getAttribute('aria-labelledby')
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Settings')
  })

  it('emits update:modelValue(false) when the close button is clicked', async () => {
    wrapper = await mountSuspended(Dialog, { props: { modelValue: true, title: 'Settings' } })
    const closeButton = document.body.querySelector('[aria-label="Close"]') as HTMLElement
    closeButton.click()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('emits update:modelValue(false) when the scrim is clicked', async () => {
    wrapper = await mountSuspended(Dialog, { props: { modelValue: true, title: 'Settings' } })
    const scrim = document.body.querySelector('[role="dialog"]')!.parentElement as HTMLElement
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('does not close when clicking inside the panel', async () => {
    wrapper = await mountSuspended(Dialog, {
      props: { modelValue: true, title: 'Settings' },
      slots: { default: '<p>Body</p>' },
    })
    const panel = document.body.querySelector('[role="dialog"]') as HTMLElement
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('closes on Escape', async () => {
    wrapper = await mountSuspended(Dialog, { props: { modelValue: true, title: 'Settings' } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('locks page scroll while open and releases it once closed', async () => {
    wrapper = await mountSuspended(Dialog, { props: { modelValue: true, title: 'Settings' } })
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.setProps({ modelValue: false })
    expect(document.body.style.overflow).toBe('')
  })

  it('traps Tab focus between the first and last focusable elements in the panel', async () => {
    wrapper = await mountSuspended(Dialog, {
      props: { modelValue: true, title: 'Settings' },
      slots: { content: '<button>First</button><button>Second</button>' },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    const buttons = [...document.body.querySelectorAll('button')]
    const closeButton = buttons.find(b => b.getAttribute('aria-label') === 'Close')!
    const second = buttons.find(b => b.textContent === 'Second')!

    // Forward Tab from the last focusable (Second) wraps to the first (Close).
    second.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(closeButton)

    // Backward Shift+Tab from the first focusable wraps to the last (Second).
    closeButton.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(second)
  })

  it('restores focus to the element that was focused before opening', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    wrapper = await mountSuspended(Dialog, { props: { modelValue: true, title: 'Settings' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.activeElement).not.toBe(opener)

    await wrapper.setProps({ modelValue: false })
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
