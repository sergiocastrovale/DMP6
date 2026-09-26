import { defineStore } from 'pinia'
import { useDebounceFn, useThrottleFn } from '@vueuse/core'
import type { PlayerTrack, ShuffleMode, ExploreParams, PersistedPlayerState, MediaSessionTrackMeta, PlaySource } from '~/types/player'
import { toPlayerTrack } from '~/helpers/playerTrack'
import { apiErrorMessage } from '~/helpers/apiError'
import { MAX_CONSECUTIVE_PLAYBACK_ERRORS } from '~/helpers/constants'
import { EXPLORER_SESSION_HISTORY_CAP, nextIndexWrap, playbackErrorAction, pushCapped, QUEUE_PERSIST_CAP, shouldScrobble, shuffleArray, sliceForPersist, unshiftCapped } from '~/helpers/playerLogic'

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
  const history = ref<PlayerTrack[]>([])
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
  let consecutivePlaybackErrors = 0

  const { resolve } = useImageUrl()
  const nativeBridge = useNativeBridge()
  const playEvents = createPlayEventTracker()

  const media = createMediaSession({
    isPlaying: () => isPlaying.value,
    currentTime: () => currentTime.value,
    duration: () => duration.value,
    play: () => { if (!isPlaying.value) {togglePlay()} },
    pause: () => { if (isPlaying.value) {togglePlay()} },
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
    if (!currentTrack.value) {return}
    if (!shouldScrobble({ duration: duration.value, currentTime: currentTime.value })) {return}
    if (scrobbled) {return}
    scrobbled = true
    $fetch('/api/scrobble/scrobble', {
      method: 'POST',
      body: { trackId: currentTrack.value.id, timestamp: scrobbleStartTime },
    }).catch(() => {})
  }

  // A file that is missing on disk or will not decode must not stop a queue or radio session dead: log it as a
  // skip, tell the user, and move on - unless several in a row fail, which means something bigger is wrong.
  function onPlaybackError(code: number | undefined) {
    const outcome = playbackErrorAction(consecutivePlaybackErrors, code, MAX_CONSECUTIVE_PLAYBACK_ERRORS)
    consecutivePlaybackErrors = outcome.consecutiveErrors
    if (outcome.action === 'ignore') {return}
    playEvents.finish('error')
    const toast = useToastStore()
    if (outcome.action === 'stop') {
      toast.error(`Stopped after ${MAX_CONSECUTIVE_PLAYBACK_ERRORS} unplayable tracks in a row`)
      return
    }
    toast.error('Skipped unplayable track')
    next()
  }

  function getAudio(): HTMLAudioElement {
    if (!audio && import.meta.client) {
      audio = new Audio()
      audio.addEventListener('timeupdate', () => {
        currentTime.value = audio!.currentTime
        if (audio!.currentTime > 0) {consecutivePlaybackErrors = 0}
        checkScrobble()
        playEvents.onTimeUpdate(audio!.currentTime, duration.value)
        media.updatePosition()
      })
      audio.addEventListener('loadedmetadata', () => {
        duration.value = audio!.duration
      })
      audio.addEventListener('ended', () => {
        playEvents.finish('ended')
        next()
      })
      audio.addEventListener('error', () => {
        isPlaying.value = false
        media.setPlaybackState('paused')
        onPlaybackError(audio!.error?.code)
      })
      audio.volume = isMuted.value ? 0 : volume.value
      media.registerHandlers()
      // Beacon-only finish for the in-flight play event - a normal PATCH may not survive the page
      // unloading before it completes (composables/usePlayEventTracker.ts).
      window.addEventListener('pagehide', () => playEvents.finishOnHide())
    }
    return audio!
  }

  async function playTrack(track: PlayerTrack, newQueue?: PlayerTrack[], source?: PlaySource) {
    // Delegate entirely to setQueue, which calls back into playTrack(track) with no newQueue - a single
    // history push and a single audio/metadata setup, instead of doing both here AND in the recursive call.
    if (newQueue) {
      setQueue(newQueue, track)
      return
    }

    const a = getAudio()
    if (currentTrack.value?.id) {
      pushCapped(history.value, currentTrack.value, 50)
    }
    currentTrack.value = track
    isVisible.value = true
    media.setMetadata(trackMeta(track))

    a.src = `/api/audio/${track.id}`
    a.load()
    scrobbled = false
    scrobbleStartTime = Date.now()
    media.resetPositionThrottle()
    // shuffleMode/currentPlaylistSlug are already set by the caller (pickExplorerTrack/setExplorerTrack
    // set 'explorer', next()'s catalogue branch is already in 'catalogue', playPlaylist sets the slug
    // before calling here) - an explicit `source` is only needed where none of those apply, i.e. next()'s
    // no-queue random fallback.
    const resolvedSource: PlaySource = source
      ?? (shuffleMode.value === 'explorer'
        ? 'EXPLORER'
        : shuffleMode.value === 'catalogue'
          ? 'CATALOGUE'
          : currentPlaylistSlug.value
            ? 'PLAYLIST'
            : 'QUEUE')
    playEvents.start(track.id, resolvedSource, track.duration)
    try {
      await a.play()
      isPlaying.value = true
      media.setPlaybackState('playing')
      nativeBridge.startPlaybackService(`${track.artist} - ${track.title}`)
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
    if (!currentTrack.value) {return}
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
    playEvents.finish('dismissed')
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
    if (catalogueBufferFetching || catalogueBuffer.value.length >= 5) {return}
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
      unshiftCapped(explorerSessionHistory.value, explorerCurrentTrack.value, EXPLORER_SESSION_HISTORY_CAP)
    }
    explorerParams.value = params
    shuffleMode.value = 'explorer'

    const track = await fetchExplorerTrack(params)
    if (!track) {return}

    explorerCurrentTrack.value = track
    pushCapped(explorerHistory.value, track.id, 50)
    playTrack(track)
  }

  // Called when replaying a history track from the Explore page
  function setExplorerTrack(track: PlayerTrack, params: ExploreParams): void {
    if (explorerCurrentTrack.value && explorerCurrentTrack.value.id !== track.id) {
      unshiftCapped(explorerSessionHistory.value, explorerCurrentTrack.value, EXPLORER_SESSION_HISTORY_CAP)
    }
    explorerCurrentTrack.value = track
    explorerParams.value = params
    shuffleMode.value = 'explorer'
    explorerHistory.value = [track.id]
    playTrack(track)
  }

  async function next() {
    if (shuffleMode.value === 'explorer') {
      if (!explorerParams.value) {return}
      if (explorerCurrentTrack.value) {
        unshiftCapped(explorerSessionHistory.value, explorerCurrentTrack.value, EXPLORER_SESSION_HISTORY_CAP)
      }
      const track = await fetchExplorerTrack(explorerParams.value)
      if (track) {
        explorerCurrentTrack.value = track
        pushCapped(explorerHistory.value, track.id, 50)
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
          if (track) {playTrack(track)}
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
        if (track) {playTrack(track, undefined, 'RANDOM')}
      }
      catch { /* ignore */ }
      return
    }

    const idx = queue.value.findIndex(t => t.id === currentTrack.value?.id)
    const nextIdx = nextIndexWrap(queue.value.length, idx)
    if (nextIdx !== null) {
      playTrack(queue.value[nextIdx]!)
    }
  }

  function previous() {
    if (currentTime.value > 3) {
      seek(0)
      return
    }
    const track = history.value.pop()
    if (track) {
      playTrack(track)
    }
    else {
      seek(0)
    }
  }

  async function fetchReleaseTracks(localReleaseId: string): Promise<PlayerTrack[]> {
    const res = await $fetch<{ release: { image: string | null, imageUrl: string | null, artistSlug: string } | null, tracks: any[] }>(`/api/releases/${localReleaseId}/tracks`)
    return res.tracks
      .filter(t => !t.missing)
      .map(t => toPlayerTrack(t, { artistSlug: res.release?.artistSlug, releaseImage: res.release?.image, releaseImageUrl: res.release?.imageUrl }))
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
        catch (e) {
          useToastStore().error(apiErrorMessage(e, 'Could not load the release for shuffling'))
        }
      }
    }
    else if (newMode === 'artist') {
      const artistSlug = currentTrack.value?.artistSlug
        || originalQueue.value.find(t => t.artistSlug)?.artistSlug
      if (artistSlug) {
        try {
          // Server-sampled and already shaped for the player, with cover art (the old mapping left it null).
          const tracks = await $fetch<PlayerTrack[]>(`/api/artists/${artistSlug}/shuffle`)
          originalQueue.value = tracks
          queue.value = shuffleArray([...tracks])
        }
        catch (e) {
          useToastStore().error(apiErrorMessage(e, 'Could not load the artist for shuffling'))
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


  // Persist state
  if (import.meta.client) {
    // Nuxt's Pinia SSR hydration patches every ref on this store back to the server-rendered
    // value immediately after setup() returns (createSetupStore does `prop.value =
    // initialState[key]` for each ref, using the payload captured before setup ran) - and the
    // server always renders this store empty, since `import.meta.client` is false there. Doing
    // the restore inline here used to work for a single synchronous tick and then get silently
    // clobbered back to null/[] before any component had even mounted, so a reload only "restored"
    // the bar for a flash before wiping it - and then the debounced watch below persisted that
    // wiped state right back to localStorage. onMounted always runs after that hydration patch is
    // done, which is why useTheme.ts reads its own localStorage entry the same way.
    //
    // onMounted alone is not enough: it only registers when the store is first created inside a
    // component's setup(). plugins/presence.client.ts creates it from a plugin, before any component
    // exists - onMounted then had no instance to attach to and the restore silently never ran.
    // `useAfterHydration` covers every way the store can come to life.
    const restore = () => {
      const saved = localStorage.getItem('dmp-player')
      if (!saved) {
        return
      }
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
            // playTrack() never ran for this restore, so scrobbleStartTime is still its 0
            // default - checkScrobble() would send timestamp:0, which the API rejects as falsy.
            scrobbleStartTime = Date.now()
            scrobbled = false
            // Restore position but don't auto-play - no PlayEvent is reopened for a restored
            // position either (composables/usePlayEventTracker.ts); one starts fresh on next play().
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
    useAfterHydration(restore)

    const buildPersistedState = (): PersistedPlayerState => ({
      trackId: currentTrack.value?.id ?? null,
      currentTime: currentTime.value,
      volume: volume.value,
      isMuted: isMuted.value,
      shuffleMode: shuffleMode.value,
      queue: sliceForPersist(queue.value, QUEUE_PERSIST_CAP),
      originalQueue: sliceForPersist(originalQueue.value, QUEUE_PERSIST_CAP),
      explorerParams: explorerParams.value,
    })

    const saveState = useDebounceFn(() => {
      localStorage.setItem('dmp-player', JSON.stringify(buildPersistedState()))
    }, 500)

    // currentTime ticks every ~250ms during playback and isn't in the structural watch below (it would
    // fire the debounce constantly and never let it settle) - persist it on its own throttle instead, so
    // resume position doesn't go stale until some other field happens to change.
    const savePosition = useThrottleFn(() => {
      localStorage.setItem('dmp-player', JSON.stringify(buildPersistedState()))
    }, 5000)

    // Shallow on purpose: every field here is replaced, never mutated (the queue is reassigned by setQueue/
    // playPlaylist/shuffle, explorerParams by the explorer actions). A deep watch would walk a 2000-track queue on
    // every change.
    watch([currentTrack, volume, isMuted, shuffleMode, queue, explorerParams], saveState)
    watch(currentTime, savePosition)
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
