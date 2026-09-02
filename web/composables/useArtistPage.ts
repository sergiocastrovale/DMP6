import type { Ref } from 'vue'
import type { Artist } from '~/types/artist'
import type { UnifiedRelease } from '~/types/release'
import type { Track } from '~/types/track'
import type { DlStatusValue, DlStatusItem } from '~/types/download'
import { useTerminalStore } from '~/stores/terminal'
import { artistScanFolders, dlPollNeeded, filterInFlight, mergeDownloadStatus, tracksToPlayerTracks } from '~/helpers/artistPageLogic'
import { DL_POLL_LIVE_MS, DL_POLL_MONITORED_MS } from '~/helpers/constants'
import { useDownloadsStore } from '~/stores/downloads'

// Data fetching + polling for the artist detail page: artist/releases fetch, per-release download
// status polling (acquisition pipeline), the monitor toggle, and "play all". Extracted out of
// pages/artist/[slug].vue to keep the page itself down to layout/composition.
export const useArtistPage = (slug: Ref<string>) => {
  const terminal = useTerminalStore()
  const player = usePlayerStore()
  const downloads = useDownloadsStore()

  const { data: artist, pending: artistPending, error } = useFetch<Artist>(() => `/api/artists/${slug.value}`, {
    key: () => `artist-${slug.value}`,
  })

  const { data: releasesData, pending: releasesPending, refresh: refreshReleases } = useFetch(() => `/api/artists/${slug.value}/releases`, {
    key: () => `artist-releases-${slug.value}`,
    query: { pageSize: 500 },
  })

  const dlStatusMap = ref<Map<string, DlStatusValue>>(new Map())
  let dlPoll: ReturnType<typeof setTimeout> | null = null

  // Something is mid-flight: an acquisition row that moves on its own, or a merge that will retire
  // one. mergeActive covers the READY -> merged -> row-gone transition kicked from ReleaseGroupDetails.
  const dlLive = computed(() => dlPollNeeded(dlStatusMap.value) || downloads.mergeActive)

  // How long until the next fetch - null means stop entirely. A monitored artist keeps a slow
  // heartbeat because background auto-acquisition can create rows with no click in this tab.
  const dlPollDelay = computed(() =>
    dlLive.value ? DL_POLL_LIVE_MS : artist.value?.monitored ? DL_POLL_MONITORED_MS : null,
  )

  const stopDlPolling = () => {
    if (dlPoll) {
      clearTimeout(dlPoll)
      dlPoll = null
    }
  }

  // Demand-driven, self-terminating chain (same shape as the downloads store's queue/merge polls):
  // every tick re-reads the delay, so the cadence follows the state and the loop stops on its own
  // once an idle unmonitored artist has nothing left to watch.
  const startDlPolling = () => {
    if (dlPoll) {
      return
    }
    const tick = async () => {
      await fetchDownloadStatus()
      const delay = dlPollDelay.value
      dlPoll = delay === null ? null : setTimeout(tick, delay)
    }
    const delay = dlPollDelay.value
    if (delay !== null) {
      dlPoll = setTimeout(tick, delay)
    }
  }

  // Any fetch (mount, user action, monitor toggle) re-arms or tears down the loop as needed.
  const ensureDlPolling = () => {
    if (dlPollDelay.value === null) {
      stopDlPolling()
      return
    }
    startDlPolling()
  }

  const fetchDownloadStatus = async () => {
    try {
      const data = await $fetch<{ items: DlStatusItem[] }>(`/api/artists/${slug.value}/download-status`)
      const next = new Map<string, DlStatusValue>()
      for (const i of data.items) {
        if (i.mbReleaseId) { next.set(i.mbReleaseId, { status: i.status, downloadedReleaseId: i.downloadedReleaseId, percent: i.percent, bytesTransferred: i.bytesTransferred, totalBytes: i.totalBytes }) }
      }
      // An item that was ready and is now gone was promoted (or rejected) ->
      // refresh the release list so the card flips to its final form.
      for (const [mbId, prev] of dlStatusMap.value) {
        if (prev.status === 'READY' && !next.has(mbId)) {
          refreshReleases()
          break
        }
      }
      dlStatusMap.value = next
    }
    catch { /* ignore */ }
    ensureDlPolling()
  }

  onMounted(() => { fetchDownloadStatus() })
  onUnmounted(() => { stopDlPolling() })

  const releases = computed(() =>
    mergeDownloadStatus((releasesData.value?.releases ?? []) as UnifiedRelease[], dlStatusMap.value),
  )

  // In-flight acquisitions (download/enrich phase) for the header aggregate bar.
  const dlInFlight = computed(() => filterInFlight(dlStatusMap.value))

  // --- Monitor toggle (Lidarr-style auto-download of missing releases) ---
  const monitorBusy = ref(false)
  const toggleMonitor = async () => {
    if (!artist.value || monitorBusy.value) { return }
    monitorBusy.value = true
    const target = !artist.value.monitored
    artist.value.monitored = target // optimistic
    try {
      await $fetch<unknown, string>(`/api/artists/${slug.value}`, { method: 'PATCH', body: { monitored: target } })
      if (target) { fetchDownloadStatus() } // kick fired server-side; surface rows ASAP
    }
    catch {
      artist.value.monitored = !target // revert
    }
    finally {
      ensureDlPolling() // monitoring off (or the revert) tears the heartbeat down
      monitorBusy.value = false
    }
  }

  // A merge (started from a release card) retires the READY row it merges - poll until it's gone.
  watch(() => downloads.mergeActive, () => { ensureDlPolling() })

  // monitored arrives with the artist fetch, after the mount kick has already run.
  watch(() => artist.value?.monitored, () => { ensureDlPolling() })

  watch(() => terminal.isRunning, (running, wasRunning) => {
    if (wasRunning && !running) {
      refreshReleases()
      fetchDownloadStatus() // a scan/merge run can create or retire acquisition rows
    }
  })

  const pending = computed(() => artistPending.value || releasesPending.value)

  const artistFolders = computed(() => artistScanFolders(releases.value, artist.value?.name ?? ''))

  const playingAll = ref(false)
  const playAll = async () => {
    if (playingAll.value) {
      return
    }
    playingAll.value = true
    try {
      const tracks = await $fetch<Track[]>(`/api/artists/${slug.value}/tracks`)
      const playerTracks = tracksToPlayerTracks(tracks, slug.value)
      if (!playerTracks.length) {
        return
      }
      player.setQueue(playerTracks, playerTracks[0])
    }
    catch { /* ignore */ }
    finally {
      playingAll.value = false
    }
  }

  const shufflingAll = ref(false)
  const shuffleAll = async () => {
    if (shufflingAll.value) {
      return
    }
    shufflingAll.value = true
    try {
      const tracks = await $fetch<Track[]>(`/api/artists/${slug.value}/tracks`)
      const playerTracks = tracksToPlayerTracks(tracks, slug.value)
      if (!playerTracks.length) {
        return
      }
      player.shuffleMode = 'artist'
      player.setQueue(playerTracks)
    }
    catch { /* ignore */ }
    finally {
      shufflingAll.value = false
    }
  }

  return {
    artist,
    error,
    pending,
    releases,
    dlInFlight,
    refreshDownloadStatus: fetchDownloadStatus,
    monitorBusy,
    toggleMonitor,
    artistFolders,
    playingAll,
    playAll,
    shufflingAll,
    shuffleAll,
  }
}
