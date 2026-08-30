import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ErrorPage from '../../error.vue'

const { clearErrorMock } = vi.hoisted(() => ({ clearErrorMock: vi.fn() }))
mockNuxtImport('clearError', () => clearErrorMock)

describe('error.vue', () => {
  it('shows the friendly 404 title and description', async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: { statusCode: 404 } } })
    expect(wrapper.text()).toContain('404')
    expect(wrapper.text()).toContain('Page Not Found')
  })

  it('shows the friendly 500 title and description', async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: { statusCode: 500 } } })
    expect(wrapper.text()).toContain('Server Error')
  })

  it('falls back to the statusMessage for other codes', async () => {
    const wrapper = await mountSuspended(ErrorPage, {
      props: { error: { statusCode: 403, statusMessage: 'Forbidden' } },
    })
    expect(wrapper.text()).toContain('Forbidden')
  })

  it('the home button clears the error and redirects', async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: { statusCode: 404 } } })
    await wrapper.get('button').trigger('click')
    expect(clearErrorMock).toHaveBeenCalledWith({ redirect: '/' })
  })
})
