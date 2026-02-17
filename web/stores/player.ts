import { defineStore } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import type { PlayerTrack, ShuffleMode, PersistedPlayerState } from '~/types/player'

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

  let audio: HTMLAudioElement | null = null

  function getAudio(): HTMLAudioElement {
    if (!audio && import.meta.client) {
      audio = new Audio()
      audio.addEventListener('timeupdate', () => {
        currentTime.value = audio!.currentTime
      })
      audio.addEventListener('loadedmetadata', () => {
        duration.value = audio!.duration
      })
      audio.addEventListener('ended', () => {
        next()
      })
      audio.addEventListener('error', () => {
        isPlaying.value = false
      })
      audio.volume = isMuted.value ? 0 : volume.value
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

    // Set queue if provided
    if (newQueue) {
      setQueue(newQueue, track)
      return // setQueue will handle playback
    }

    a.src = `/api/audio/${track.id}`
    a.load()
    try {
      await a.play()
      isPlaying.value = true
      $fetch(`/api/tracks/${track.id}/play`, { method: 'POST' }).catch(() => {})
    }
    catch {
      isPlaying.value = false
    }
  }

  function togglePlay() {
    const a = getAudio()
    if (!currentTrack.value) return
    if (isPlaying.value) {
      a.pause()
      isPlaying.value = false
    }
    else {
      a.play().then(() => { isPlaying.value = true }).catch(() => {})
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

  function setQueue(tracks: PlayerTrack[], startTrack?: PlayerTrack) {
    originalQueue.value = [...tracks]
    queue.value = shuffleMode.value !== 'off' ? shuffleArray([...tracks]) : [...tracks]
    if (startTrack) {
      playTrack(startTrack)
    }
    else if (tracks.length > 0) {
      playTrack(queue.value[0])
    }
  }

  async function next() {
    if (shuffleMode.value === 'catalogue') {
      try {
        const track = await $fetch<PlayerTrack>('/api/tracks/random')
        if (track) playTrack(track)
      }
      catch { /* ignore */ }
      return
    }

    if (queue.value.length === 0) return
    const idx = queue.value.findIndex(t => t.id === currentTrack.value?.id)
    const nextIdx = idx + 1
    if (nextIdx < queue.value.length) {
      playTrack(queue.value[nextIdx])
    }
    else if (queue.value.length > 0) {
      playTrack(queue.value[0])
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

  async function cycleShuffleMode() {
    const modes: ShuffleMode[] = ['off', 'release', 'artist', 'catalogue']
    const idx = modes.indexOf(shuffleMode.value)
    const newMode = modes[(idx + 1) % modes.length]
    shuffleMode.value = newMode

    // Fetch appropriate tracks for the new mode
    if (newMode === 'release' && currentTrack.value?.releaseId) {
      try {
        const tracks = await $fetch<PlayerTrack[]>(`/api/releases/${currentTrack.value.releaseId}/tracks`)
        originalQueue.value = tracks
        queue.value = shuffleArray([...tracks])
      }
      catch (error) {
        console.error('Failed to load release tracks:', error)
      }
    }
    else if (newMode === 'artist' && currentTrack.value?.artistSlug) {
      try {
        const tracks = await $fetch<PlayerTrack[]>(`/api/artists/${currentTrack.value.artistSlug}/tracks`)
        originalQueue.value = tracks
        queue.value = shuffleArray([...tracks])
      }
      catch (error) {
        console.error('Failed to load artist tracks:', error)
      }
    }
    else if (newMode === 'off') {
      queue.value = [...originalQueue.value]
    }
    else if (newMode !== 'catalogue') {
      queue.value = shuffleArray([...originalQueue.value])
    }
  }

  function shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
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
        shuffleMode.value = state.shuffleMode ?? 'off'
        queue.value = state.queue ?? []
        originalQueue.value = state.originalQueue ?? []
        if (state.trackId && state.queue?.length) {
          const track = state.queue.find(t => t.id === state.trackId)
          if (track) {
            currentTrack.value = track
            isVisible.value = true
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

    const saveState = useDebounceFn(() => {
      const state: PersistedPlayerState = {
        trackId: currentTrack.value?.id ?? null,
        currentTime: currentTime.value,
        volume: volume.value,
        isMuted: isMuted.value,
        shuffleMode: shuffleMode.value,
        queue: queue.value,
        originalQueue: originalQueue.value,
      }
      localStorage.setItem('dmp-player', JSON.stringify(state))
    }, 500)

    watch([currentTrack, volume, isMuted, shuffleMode, queue], saveState, { deep: true })
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
    playTrack,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setQueue,
    next,
    previous,
    cycleShuffleMode,
  }
})
