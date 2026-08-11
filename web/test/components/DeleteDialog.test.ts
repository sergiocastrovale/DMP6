import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DeleteDialog from '../../components/artist/DeleteDialog.vue'

// Plain values, not refs: vi.hoisted runs before vue is imported.
const { runMock, terminal, toast } = vi.hoisted(() => ({
  runMock: vi.fn().mockResolvedValue(undefined),
  terminal: { exitCode: 0 },
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('~/stores/terminal', () => ({
  useTerminalStore: () => ({ run: runMock, get exitCode() { return terminal.exitCode } }),
}))

vi.mock('~/stores/toast', () => ({
  useToastStore: () => toast,
}))

// The component redirects with router.push, not navigateTo: the redirect runs after an await, past the
// point where the Nuxt instance is still available.
// The component redirects through nuxtApp.runWithContext(() => navigateTo(...)): the redirect runs
// after an await, where the Nuxt instance would otherwise be gone.
const pushMock = vi.fn()
mockNuxtImport('navigateTo', () => pushMock)

// ConfirmDialog renders through Dialog.vue's <Teleport to="body">, so the switch and buttons land
// outside the wrapper's own subtree.
const bodyButtons = () => [...document.body.querySelectorAll('button')]
const clickText = async (text: string) => {
  const button = bodyButtons().find(b => b.textContent?.trim() === text)
  await button!.dispatchEvent(new Event('click'))
}

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

const mount = async () => {
  wrapper = await mountSuspended(DeleteDialog, {
    props: { modelValue: true, artistName: 'Boards of Canada' },
  })
  return wrapper
}

describe('artist/DeleteDialog.vue', () => {
  beforeEach(() => {
    runMock.mockClear()
    pushMock.mockClear()
    toast.success.mockClear()
    toast.error.mockClear()
    terminal.exitCode = 0
  })

  it('offers the file removal opt-in unchecked, so a stray confirm keeps the audio', async () => {
    await mount()
    const toggle = document.body.querySelector('[role="switch"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    expect(document.body.textContent).toContain('Remove all files from this artist')
  })

  it('deletes the catalogue only by default', async () => {
    await mount()
    await clickText('Remove from catalogue')
    expect(runMock).toHaveBeenCalledWith('./delete', ['Boards of Canada', '--y'], 'dmp-delete')
  })

  it('adds --files only once the opt-in is switched on', async () => {
    await mount()
    await document.body.querySelector('[role="switch"]')!.dispatchEvent(new Event('click'))
    await nextTick()
    await clickText('Delete artist and files')
    expect(runMock).toHaveBeenCalledWith('./delete', ['Boards of Canada', '--y', '--files'], 'dmp-delete')
  })

  it('leaves the artist page for /browse once the run succeeds', async () => {
    await mount()
    await clickText('Remove from catalogue')
    await nextTick()
    expect(toast.success).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/browse')
  })

  it('stays put and reports failure on a non-zero exit', async () => {
    terminal.exitCode = 1
    await mount()
    await clickText('Remove from catalogue')
    await nextTick()
    expect(toast.error).toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
