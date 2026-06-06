import { defineStore } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import type { PlayerTrack, ShuffleMode, ExploreParams, PersistedPlayerState } from '~/types/player'

export const usePlayerStore = defineStore('player', () => { 
  const currentTrack = ref<PlayerTrack | null>(null)
  const queue = ref<PlayerTrack[]>([])
  const originalQueue = ref<PlayerTrack[]>([])
  const isPlaying = ref(false)
  const volume = ref(0.75)
  const isMuted = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const isVisible = ref(false)
  const shuffleMode = ref<ShuffleMode>('off')
  const history = ref<string[]>([])
  const explorerParams = ref<ExploreParams | null>(null)
  // Track IDs played during the current explorer session - used for deduplication
  const explorerHistory = ref<string[]>([])
  // Explorer session state - drives the /explore page reactively
  const explorerCurrentTrack = ref<PlayerTrack | null>(null)
  const explorerSessionHistory = ref<PlayerTrack[]>([])
  // Pre-fetched tracks for catalogue shuffle - eliminates per-song network latency
  const catalogueBuffer = ref<PlayerTrack[]>([])
  let catalogueBufferFetching = false
  const currentPlaylistSlug = ref<string | null>(null)

  let audio: HTMLAudioElement | null = null
  let scrobbleStartTime = 0
  let scrobbled = false

  const { resolve } = useImageUrl()
  const nativeBridge = useNativeBridge()

  const media = createMediaSession({
    isPlaying: () => isPlaying.value,
    currentTime: () => currentTime.value,
    duration: () => duration.value,
    play: () => { if (!isPlaying.value) togglePlay() },
    pause: () => { if (isPlaying.value) togglePlay() },
    next: () => { next() },
    previous: () => { previous() },
    seek: (time: number) => { seek(time) },
  })

  function trackMeta(track: PlayerTrack): MediaSessionTrackMeta {
    return {
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: resolve(track.releaseImage, track.releaseImageUrl, 'releases'),
    }
  }

  function checkScrobble() {
    if (scrobbled || !currentTrack.value) return
    const dur = duration.value
    const cur = currentTime.value
    if (dur < 30) return
    if (cur > dur * 0.5 || cur > 240) {
      scrobbled = true
      $fetch('/api/scrobble/scrobble', {
        method: 'POST',
        body: { trackId: currentTrack.value.id, timestamp: scrobbleStartTime },
      }).catch(() => {})
    }
  }

  function getAudio(): HTMLAudioElement {
    if (!audio && import.meta.client) {
      audio = new Audio()
      audio.addEventListener('timeupdate', () => {
        currentTime.value = audio!.currentTime
        checkScrobble()
        media.updatePosition()
      })
      audio.addEventListener('loadedmetadata', () => {
        duration.value = audio!.duration
      })
      audio.addEventListener('ended', () => {
        next()
      })
      audio.addEventListener('error', () => {
        isPlaying.value = false
        media.setPlaybackState('paused')
      })
      audio.volume = isMuted.value ? 0 : volume.value
      media.registerHandlers()
    }
    return audio!
  }

  async function playTrack(track: PlayerTrack, newQueue?: PlayerTrack[]) {
    const a = getAudio()
    if (currentTrack.value?.id) {
      history.value.push(currentTrack.value.id)
      if (history.value.length > 50) history.value.shift()
    }
    currentTrack.value = track
    isVisible.value = true
    media.setMetadata(trackMeta(track))

    // Set queue if provided
    if (newQueue) {
      setQueue(newQueue, track)
      return // setQueue will handle playback
    }

    a.src = `/api/audio/${track.id}`
    a.load()
    scrobbled = false
    scrobbleStartTime = Date.now()
    media.resetPositionThrottle()
    try {
      await a.play()
      isPlaying.value = true
      media.setPlaybackState('playing')
      nativeBridge.startPlaybackService(`${track.artist} - ${track.title}`)
      $fetch(`/api/tracks/${track.id}/play`, { method: 'POST' }).catch(() => {})
      $fetch('/api/scrobble/now-playing', {
        method: 'POST',
        body: { trackId: track.id },
      }).catch(() => {})
    }
    catch {
      isPlaying.value = false
      media.setPlaybackState('paused')
    }
  }

  function togglePlay() {
    const a = getAudio()
    if (!currentTrack.value) return
    if (isPlaying.value) {
      a.pause()
      isPlaying.value = false
      media.setPlaybackState('paused')
    }
    else {
      a.play().then(() => {
        isPlaying.value = true
        media.setPlaybackState('playing')
      }).catch(() => {})
    }
  }

  function seek(time: number) {
    const a = getAudio()
    if (a.src) {
      a.currentTime = time
      currentTime.value = time
    }
  }

  function setVolume(val: number) {
    volume.value = val
    isMuted.value = false
    const a = getAudio()
    a.volume = val
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
    const a = getAudio()
    a.volume = isMuted.value ? 0 : volume.value
  }

  function dismiss() {
    const a = getAudio()
    a.pause()
    isPlaying.value = false
    isVisible.value = false
    media.setPlaybackState('paused')
    nativeBridge.stopPlaybackService()
  }

  function setQueue(tracks: PlayerTrack[], startTrack?: PlayerTrack) {
    currentPlaylistSlug.value = null
    originalQueue.value = [...tracks]
    queue.value = shuffleMode.value !== 'off' ? shuffleArray([...tracks]) : [...tracks]
    if (startTrack) {
      playTrack(startTrack)
    }
    else if (queue.value.length > 0) {
      playTrack(queue.value[0]!)
    }
  }

  function playPlaylist(slug: string, tracks: PlayerTrack[]) {
    currentPlaylistSlug.value = slug
    originalQueue.value = [...tracks]
    queue.value = shuffleMode.value !== 'off' ? shuffleArray([...tracks]) : [...tracks]
    if (queue.value.length > 0) {
      playTrack(queue.value[0]!)
    }
  }

  async function refillCatalogueBuffer() {
    if (catalogueBufferFetching || catalogueBuffer.value.length >= 5) return
    catalogueBufferFetching = true
    try {
      const tracks = await $fetch<PlayerTrack[]>('/api/tracks/random-batch?count=10')
      catalogueBuffer.value.push(...tracks)
    }
    catch { /* ignore */ }
    finally { catalogueBufferFetching = false }
  }

  async function fetchExplorerTrack(params: ExploreParams): Promise<PlayerTrack | null> {
    try {
      return await $fetch<PlayerTrack>('/api/tracks/explore', {
        method: 'POST',
        body: { ...params, excludeIds: explorerHistory.value },
      })
    }
    catch { return null }
  }

  // Called from the Explore page button - fetches next track, updates session state, plays it
  async function pickExplorerTrack(params: ExploreParams): Promise<void> {
    if (explorerCurrentTrack.value) {
      explorerSessionHistory.value.unshift(explorerCurrentTrack.value)
      if (explorerSessionHistory.value.length > 200) explorerSessionHistory.value.length = 200
    }
    explorerParams.value = params
    shuffleMode.value = 'explorer'

    const track = await fetchExplorerTrack(params)
    if (!track) return

    explorerCurrentTrack.value = track
    explorerHistory.value.push(track.id)
    if (explorerHistory.value.length > 50) explorerHistory.value.shift()
    playTrack(track)
  }

  // Called when replaying a history track from the Explore page
  function setExplorerTrack(track: PlayerTrack, params: ExploreParams): void {
    if (explorerCurrentTrack.value && explorerCurrentTrack.value.id !== track.id) {
      explorerSessionHistory.value.unshift(explorerCurrentTrack.value)
      if (explorerSessionHistory.value.length > 200) explorerSessionHistory.value.length = 200
    }
    explorerCurrentTrack.value = track
    explorerParams.value = params
    shuffleMode.value = 'explorer'
    explorerHistory.value = [track.id]
    playTrack(track)
  }

  async function next() {
    if (shuffleMode.value === 'explorer') {
      if (!explorerParams.value) return
      if (explorerCurrentTrack.value) {
        explorerSessionHistory.value.unshift(explorerCurrentTrack.value)
        if (explorerSessionHistory.value.length > 200) explorerSessionHistory.value.length = 200
      }
      const track = await fetchExplorerTrack(explorerParams.value)
      if (track) {
        explorerCurrentTrack.value = track
        explorerHistory.value.push(track.id)
        if (explorerHistory.value.length > 50) explorerHistory.value.shift()
        playTrack(track)
      }
      return
    }

    if (shuffleMode.value === 'catalogue') {
      if (catalogueBuffer.value.length > 0) {
        const track = catalogueBuffer.value.shift()!
        playTrack(track)
      }
      else {
        try {
          const track = await $fetch<PlayerTrack>('/api/tracks/random')
          if (track) playTrack(track)
        }
        catch { /* ignore */ }
      }
      refillCatalogueBuffer()
      return
    }

    // No queue - fall back to a random track
    if (queue.value.length === 0) {
      try {
        const track = await $fetch<PlayerTrack>('/api/tracks/random')
        if (track) playTrack(track)
      }
      catch { /* ignore */ }
      return
    }

    const idx = queue.value.findIndex(t => t.id === currentTrack.value?.id)
    const nextIdx = idx + 1
    if (nextIdx < queue.value.length) {
      playTrack(queue.value[nextIdx]!)
    }
    else if (queue.value.length > 0) {
      playTrack(queue.value[0]!)
    }
  }

  function previous() {
    if (currentTime.value > 3) {
      seek(0)
      return
    }
    const prevId = history.value.pop()
    if (prevId) {
      const track = queue.value.find(t => t.id === prevId) || originalQueue.value.find(t => t.id === prevId)
      if (track) playTrack(track)
    }
    else {
      seek(0)
    }
  }

  async function fetchReleaseTracks(localReleaseId: string): Promise<PlayerTrack[]> {
    const res = await $fetch<{ release: { image: string | null, imageUrl: string | null, artistSlug: string } | null, tracks: any[] }>(`/api/releases/${localReleaseId}/tracks`)
    return res.tracks
      .filter(t => !t.missing)
      .map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist ?? t.albumArtist ?? '',
        album: t.album ?? '',
        duration: t.duration ?? 0,
        artistSlug: res.release?.artistSlug || null,
        releaseImage: res.release?.image ?? null,
        releaseImageUrl: res.release?.imageUrl ?? null,
        localReleaseId: t.localReleaseId,
      }))
  }

  async function cycleShuffleMode() {
    // Explorer mode is toggled off directly - not part of the normal cycle
    if (shuffleMode.value === 'explorer') {
      shuffleMode.value = 'off'
      explorerParams.value = null
      explorerHistory.value = []
      explorerCurrentTrack.value = null
      explorerSessionHistory.value = []
      if (currentTrack.value?.localReleaseId) {
        try {
          const tracks = await fetchReleaseTracks(currentTrack.value.localReleaseId)
          originalQueue.value = tracks
          queue.value = tracks
        }
        catch { /* ignore */ }
      }
      return
    }

    const modes: ShuffleMode[] = ['off', 'release', 'artist', 'catalogue']
    const idx = modes.indexOf(shuffleMode.value)
    const newMode = modes[(idx + 1) % modes.length]!
    shuffleMode.value = newMode

    // Fetch appropriate tracks for the new mode
    if (newMode === 'release') {
      const localReleaseId = currentTrack.value?.localReleaseId
        || originalQueue.value.find(t => t.localReleaseId)?.localReleaseId
      if (localReleaseId) {
        try {
          const tracks = await fetchReleaseTracks(localReleaseId)
          originalQueue.value = tracks
          queue.value = shuffleArray([...tracks])
        }
        catch (error) {
          console.error('Failed to load release tracks:', error)
        }
      }
    }
    else if (newMode === 'artist') {
      const artistSlug = currentTrack.value?.artistSlug
        || originalQueue.value.find(t => t.artistSlug)?.artistSlug
      if (artistSlug) {
        try {
          const rawTracks = await $fetch<any[]>(`/api/artists/${artistSlug}/tracks`)
          const tracks: PlayerTrack[] = rawTracks
            .filter(t => t.filePath)
            .map(t => ({
              id: t.id,
              title: t.title || 'Unknown',
              artist: t.artist || t.albumArtist || 'Unknown',
              album: t.album || 'Unknown',
              duration: t.duration || 0,
              artistSlug,
              releaseImage: null,
              releaseImageUrl: null,
              localReleaseId: t.localReleaseId,
            }))
          originalQueue.value = tracks
          queue.value = shuffleArray([...tracks])
        }
        catch (error) {
          console.error('Failed to load artist tracks:', error)
        }
      }
    }
    else if (newMode === 'catalogue') {
      refillCatalogueBuffer()
    }
    else if (newMode === 'off') {
      queue.value = [...originalQueue.value]
    }
    else {
      queue.value = shuffleArray([...originalQueue.value])
    }
  }


  function shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
    }
    return arr
  }

  // Persist state
  if (import.meta.client) {
    const saved = localStorage.getItem('dmp-player')
    if (saved) {
      try {
        const state: PersistedPlayerState = JSON.parse(saved)
        volume.value = state.volume ?? 0.75
        isMuted.value = state.isMuted ?? false
        // Explorer mode can only be activated from the Explore page, never restored
        shuffleMode.value = state.shuffleMode === 'explorer' ? 'off' : (state.shuffleMode ?? 'off')
        explorerParams.value = state.explorerParams ?? null
        queue.value = state.queue ?? []
        originalQueue.value = state.originalQueue ?? []
        if (state.trackId && state.queue?.length) {
          const track = state.queue.find(t => t.id === state.trackId)
          if (track) {
            currentTrack.value = track
            isVisible.value = true
            media.setMetadata(trackMeta(track))
            media.setPlaybackState('paused')
            // Restore position but don't auto-play
            if (state.currentTime && state.currentTime > 0) {
              const a = getAudio()
              a.src = `/api/audio/${track.id}`
              a.load()
              a.currentTime = state.currentTime
            }
          }
        }
      }
      catch { /* ignore corrupt state */ }
    }

    const QUEUE_PERSIST_CAP = 200

    const saveState = useDebounceFn(() => {
      const state: PersistedPlayerState = {
        trackId: currentTrack.value?.id ?? null,
        currentTime: currentTime.value,
        volume: volume.value,
        isMuted: isMuted.value,
        shuffleMode: shuffleMode.value,
        queue: queue.value.slice(-QUEUE_PERSIST_CAP),
        originalQueue: originalQueue.value.slice(-QUEUE_PERSIST_CAP),
        explorerParams: explorerParams.value,
      }
      localStorage.setItem('dmp-player', JSON.stringify(state))
    }, 500)

    watch([currentTrack, volume, isMuted, shuffleMode, queue, explorerParams], saveState, { deep: true })
  }

  function getAudioElement(): HTMLAudioElement | null {
    return audio
  }

  return {
    currentTrack,
    queue,
    originalQueue,
    isPlaying,
    volume,
    isMuted,
    currentTime,
    duration,
    isVisible,
    shuffleMode,
    history,
    explorerParams,
    explorerHistory,
    explorerCurrentTrack,
    explorerSessionHistory,
    playTrack,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    currentPlaylistSlug,
    setQueue,
    playPlaylist,
    next,
    previous,
    cycleShuffleMode,
    pickExplorerTrack,
    setExplorerTrack,
    getAudioElement,
    dismiss,
  }
})
