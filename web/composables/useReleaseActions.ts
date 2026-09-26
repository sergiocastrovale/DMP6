import type { UnifiedRelease, ReleaseInfoExtra } from '~/types/release'
import { apiErrorMessage } from '~/helpers/apiError'
import { acquireFailureMessage, actionReleaseIds, favoriteTargetId } from '~/helpers/artistPageLogic'
import { scanSessionName } from '~/helpers/functions'
import { useDownloadsStore } from '~/stores/downloads'
import { useGlobalStore } from '~/stores/global'
import { useTerminalStore } from '~/stores/terminal'
import { useToastStore } from '~/stores/toast'

// What can be done to a release card on the artist page: download it, re-download an incomplete copy, cancel a running
// download, refresh it from disk, favorite it, and read its info. Each dialog's open flag and target live here.
export const useReleaseActions = (favoriteReleases: Ref<Set<string>>) => {
  const downloadsStore = useDownloadsStore()
  const terminal = useTerminalStore()
  const toast = useToastStore()
  const global = useGlobalStore()
  const api = useApi()
  // The artist page polls download status on demand only - acquiring or cancelling here is what creates/kills a row, so
  // it has to kick the poll back into life.
  const refreshDownloadStatus = inject<() => void>('refreshDownloadStatus', () => {})

  const acquiringIds = ref<Set<string>>(new Set())
  const redownloadRelease = ref<UnifiedRelease | null>(null)
  const showRedownloadDialog = ref(false)
  const cancelRelease = ref<UnifiedRelease | null>(null)
  const showCancelDialog = ref(false)
  const infoRelease = ref<UnifiedRelease | null>(null)
  const infoExtra = ref<ReleaseInfoExtra | null>(null)
  const showInfoDialog = ref(false)

  // replacesLocalReleaseId is set only by the re-download flow: the server stamps it on the download row so the merge
  // deletes this incomplete copy before moving the new one in.
  const acquireRelease = async (release: UnifiedRelease, replacesLocalReleaseId?: string) => {
    if (!release.mbReleaseRowId || acquiringIds.value.has(release.id)) {
      return
    }
    acquiringIds.value = new Set(acquiringIds.value).add(release.id)
    try {
      const result = await $fetch<{ status: string, otherCopyInFlight?: boolean }>('/api/downloads/acquire', {
        method: 'POST',
        body: { mbReleaseRowId: release.mbReleaseRowId, replacesLocalReleaseId },
      })
      const message = acquireFailureMessage(result.status)
      if (message) {
        toast.error(message)
      }
      else if (result.otherCopyInFlight) {
        toast.info('A download for another copy of this release is already running - it will replace that copy, not this one.')
      }
      refreshDownloadStatus()
    }
    catch (e) {
      toast.error(apiErrorMessage(e, 'Download request failed'))
    }
    finally {
      const next = new Set(acquiringIds.value)
      next.delete(release.id)
      acquiringIds.value = next
    }
  }

  const openRedownloadDialog = (release: UnifiedRelease) => {
    redownloadRelease.value = release
    showRedownloadDialog.value = true
  }

  const confirmRedownload = async () => {
    showRedownloadDialog.value = false
    const release = redownloadRelease.value
    redownloadRelease.value = null
    if (release?.localReleaseId) {
      await acquireRelease(release, release.localReleaseId)
    }
  }

  const openCancelDialog = (release: UnifiedRelease) => {
    cancelRelease.value = release
    showCancelDialog.value = true
  }

  const confirmCancelDownload = async () => {
    showCancelDialog.value = false
    const id = cancelRelease.value?.downloadedReleaseId
    cancelRelease.value = null
    if (id) {
      await downloadsStore.cancel(id)
      refreshDownloadStatus()
    }
  }

  // One `./refresh --release` stage per LocalRelease - a dissolved box row carries one per disc, so a single click
  // refreshes the whole box as one run.
  const refreshRelease = (edition: UnifiedRelease) => {
    terminal.runSequence(actionReleaseIds(edition).map(id => ({
      command: './refresh',
      args: ['--release', id, '--overwrite'],
      session: scanSessionName('refresh-release', id),
    })))
  }

  const openInfoDialog = async (edition: UnifiedRelease) => {
    infoRelease.value = edition
    infoExtra.value = null
    showInfoDialog.value = true
    if (edition.localReleaseId) {
      infoExtra.value = await api.load(() => $fetch<ReleaseInfoExtra>(`/api/releases/${edition.localReleaseId}/info`), 'Could not load the release info')
    }
  }

  const toggleFavoriteRelease = async (release: UnifiedRelease) => {
    const localId = favoriteTargetId(release)
    if (!localId) {
      return
    }
    const isFavorite = favoriteReleases.value.has(localId)
    const ok = await api.run(() => $fetch<unknown>(`/api/favorites/releases/${localId}`, {
      method: isFavorite ? 'DELETE' : 'POST',
    }), 'Could not update the favorite')
    if (!ok) {
      return
    }
    if (isFavorite) {
      favoriteReleases.value.delete(localId)
      global.stats.favorites--
    }
    else {
      favoriteReleases.value.add(localId)
      global.stats.favorites++
    }
  }

  return {
    acquiringIds, acquireRelease,
    redownloadRelease, showRedownloadDialog, openRedownloadDialog, confirmRedownload,
    cancelRelease, showCancelDialog, openCancelDialog, confirmCancelDownload,
    refreshRelease,
    infoRelease, infoExtra, showInfoDialog, openInfoDialog,
    toggleFavoriteRelease,
  }
}
