import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DeleteDialog from '../../../components/release/DeleteDialog.vue'
import type { UnifiedRelease } from '../../../types/release'

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

mockNuxtImport('navigateTo', () => vi.fn())

// ConfirmDialog renders through Dialog.vue's <Teleport to="body">, so the switch and buttons land
// outside the wrapper's own subtree.
const bodyButtons = () => [...document.body.querySelectorAll('button')]
const clickText = async (text: string) => {
  const button = bodyButtons().find(b => b.textContent?.trim() === text)
  await button!.dispatchEvent(new Event('click'))
}

const release = (overrides: Partial<UnifiedRelease> = {}): UnifiedRelease => ({
  id: 'lr1', title: 'OK Computer', year: 1997, type: 'Album', typeSlug: 'album',
  mbReleaseRowId: null, musicbrainzId: null, releaseGroupId: null, disambiguation: null,
  editionLabel: null, releaseDate: null, packaging: null, country: null, format: null,
  status: 'COMPLETE', image: null, imageUrl: null, trackCount: 0, totalPlayCount: 0,
  localTrackCount: 0, isMusicBrainz: false, hasLocal: true, localReleaseId: 'lr1', folderPath: null,
  ...overrides,
} as UnifiedRelease)

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

const mount = async (overrides: Partial<UnifiedRelease> = {}) => {
  wrapper = await mountSuspended(DeleteDialog, {
    props: { modelValue: true, release: release(overrides) },
  })
  return wrapper
}

describe('release/DeleteDialog.vue', () => {
  beforeEach(() => {
    runMock.mockClear()
    toast.success.mockClear()
    toast.error.mockClear()
    terminal.exitCode = 0
  })

  it('offers the file removal opt-in unchecked, so a stray confirm keeps the audio', async () => {
    await mount()
    const toggle = document.body.querySelector('[role="switch"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    expect(document.body.textContent).toContain('Remove the actual files from disk')
  })

  it('removes the catalogue entry only by default', async () => {
    await mount()
    await clickText('Remove from catalogue')
    expect(runMock).toHaveBeenCalledWith('./delete', ['--release', 'lr1', '--y'], 'delete-release-lr1')
  })

  it('adds --files only once the opt-in is switched on', async () => {
    await mount()
    await document.body.querySelector('[role="switch"]')!.dispatchEvent(new Event('click'))
    await nextTick()
    await clickText('Delete release and files')
    expect(runMock).toHaveBeenCalledWith('./delete', ['--release', 'lr1', '--y', '--files'], 'delete-release-lr1')
  })

  it('emits removed and toasts success once the run succeeds', async () => {
    await mount()
    await clickText('Remove from catalogue')
    await nextTick()
    expect(toast.success).toHaveBeenCalled()
    expect(wrapper!.emitted('removed')).toBeTruthy()
  })

  it('reports failure and does not emit removed on a non-zero exit', async () => {
    terminal.exitCode = 1
    await mount()
    await clickText('Remove from catalogue')
    await nextTick()
    expect(toast.error).toHaveBeenCalled()
    expect(wrapper!.emitted('removed')).toBeFalsy()
  })

  // A rapid double-click can fire both click handlers before Vue's reactive `open.value = false`
  // actually removes the button from the DOM - without a guard, the second (redundant) ./delete run
  // races the first for terminal.exitCode, and a spurious failure from the second run's "already
  // deleted" error can make the first call read back a failure despite having succeeded.
  it('a second click before the run resolves does not trigger a second run', async () => {
    let resolveRun: () => void = () => {}
    runMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRun = resolve }))
    await mount()

    const button = bodyButtons().find(b => b.textContent?.trim() === 'Remove from catalogue')!
    await button.dispatchEvent(new Event('click'))
    await button.dispatchEvent(new Event('click'))
    resolveRun()
    await nextTick()

    expect(runMock).toHaveBeenCalledTimes(1)
  })
})
