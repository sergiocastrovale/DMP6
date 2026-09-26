import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import PermissionsForm from '../../../components/settings/PermissionsForm.vue'

const PERMS = ['play.view', 'sync.view']
mockNuxtImport('useCookieFetch', () => async () => ({
  matrix: { VIEWER: ['play.view'], MANAGER: ['play.view', 'sync.view'], ADMIN: [] },
  allPermissions: PERMS,
}))

describe('settings/PermissionsForm.vue', () => {
  it('shows the ADMIN column as all-checked and disabled', async () => {
    const wrapper = await mountSuspended(PermissionsForm)
    // The aria-label falls through onto UiCheckbox's root <label>, so find the input inside it.
    const admin = wrapper.findAll('label[aria-label$="for admin"] input')
    expect(admin).toHaveLength(PERMS.length)
    for (const box of admin) {
      expect((box.element as HTMLInputElement).checked).toBe(true)
      expect((box.element as HTMLInputElement).disabled).toBe(true)
    }
  })

  it('keeps VIEWER and MANAGER editable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(PermissionsForm)
    const viewerSync = wrapper.find('label[aria-label="sync.view for viewer"] input')
    expect((viewerSync.element as HTMLInputElement).disabled).toBe(false)
    await viewerSync.setValue(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    const body = fetchMock.mock.calls.find(c => c[0] === '/api/permissions')?.[1]?.body
    expect(body.matrix.VIEWER).toContain('sync.view')
    expect(body.matrix.ADMIN).toBeUndefined()
  })
})
