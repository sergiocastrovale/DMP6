import type { Ref } from 'vue'
import type { Artist } from '~/types/artist'
import type { UnifiedRelease } from '~/types/release'
import type { Track } from '~/types/track'
import { useTerminalStore } from '~/stores/terminal'
import { artistScanFolders, filterInFlight, mergeDownloadStatus, tracksToPlayerTracks, type DlStatusValue } from '~/helpers/artistPageLogic'

type DlStatusItem = { mbReleaseId: string | null, status: string, downloadedReleaseId: string, percent: number, bytesTransferred: number, totalBytes: number }

// Data fetching + polling for the artist detail page: artist/releases fetch, per-release download
// status polling (acquisition pipeline), the monitor toggle, and "play all". Extracted out of
// pages/artist/[slug].vue to keep the page itself down to layout/composition.
export const useArtistPage = (slug: Ref<string>) => {
  const terminal = useTerminalStore()
  const player = usePlayerStore()

  const { data: artist, pending: artistPending, error } = useFetch<Artist>(() => `/api/artists/${slug.value}`, {
    key: () => `artist-${slug.value}`,
  })

  const { data: releasesData, pending: releasesPending, refresh: refreshReleases } = useFetch(() => `/api/artists/${slug.value}/releases`, {
    key: () => `artist-releases-${slug.value}`,
    query: { pageSize: 500 },
  })

  const dlStatusMap = ref<Map<string, DlStatusValue>>(new Map())
  let dlPoll: ReturnType<typeof setInterval> | null = null

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
  }

  onMounted(() => {
    fetchDownloadStatus()
    dlPoll = setInterval(fetchDownloadStatus, 2000)
  })
  onUnmounted(() => { if (dlPoll) { clearInterval(dlPoll) } })

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
      monitorBusy.value = false
    }
  }

  watch(() => terminal.isRunning, (running, wasRunning) => {
    if (wasRunning && !running) {
      refreshReleases()
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
    monitorBusy,
    toggleMonitor,
    artistFolders,
    playingAll,
    playAll,
    shufflingAll,
    shuffleAll,
  }
}
