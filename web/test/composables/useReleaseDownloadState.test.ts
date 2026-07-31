import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

import { useReleaseDownloadState } from '../../composables/useReleaseDownloadState'
import type { UnifiedRelease } from '../../types/release'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const release = (downloadState: string | null, downloadedReleaseId = 'dl1') =>
  ({ downloadState, downloadedReleaseId } as unknown as UnifiedRelease)

describe('useReleaseDownloadState', () => {
  it('maps each downloadState to its flag', () => {
    expect(useReleaseDownloadState(release('DOWNLOADING')).isDownloading.value).toBe(true)
    expect(useReleaseDownloadState(release('ENRICHING')).isEnriching.value).toBe(true)
    expect(useReleaseDownloadState(release('READY')).isAwaitingMerge.value).toBe(true)
    expect(useReleaseDownloadState(release('FAILED')).downloadFailed.value).toBe(true)
    expect(useReleaseDownloadState(release('ABANDONED')).isAbandoned.value).toBe(true)
  })

  it('all flags are false for an unrelated state', () => {
    const s = useReleaseDownloadState(release('PROMOTED'))
    expect(s.isDownloading.value).toBe(false)
    expect(s.isEnriching.value).toBe(false)
    expect(s.isAwaitingMerge.value).toBe(false)
    expect(s.downloadFailed.value).toBe(false)
    expect(s.isAbandoned.value).toBe(false)
  })

  it('verifyDownload navigates to the mapped subpage with a highlight query param', () => {
    const s = useReleaseDownloadState(release('READY', 'dl42'))
    s.verifyDownload()
    expect(navigateToMock).toHaveBeenCalledWith('/downloads/merge?highlight=dl42')
  })

  it('accepts a getter function as well as a static value', () => {
    let state = 'DOWNLOADING'
    const s = useReleaseDownloadState(() => release(state))
    expect(s.isDownloading.value).toBe(true)
    state = 'READY'
    expect(s.isAwaitingMerge.value).toBe(true)
  })
})
