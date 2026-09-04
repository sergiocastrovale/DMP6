import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeVisualizerPreset, useVisualizer } from '../../composables/useVisualizer'
import { DEFAULT_VISUALIZER_PRESET, VISUALIZER_STORAGE_KEY } from '../../helpers/constants'
import { usePlayerStore } from '../../stores/player'

// Same shared-state stub useTheme.test.ts uses: `useState` is a Nuxt auto-import with no app
// context here, so back it with a plain per-key ref map.
mockNuxtImport('useState', () => {
  const stateMap = new Map<string, ReturnType<typeof ref>>()
  return (key: string, init: () => unknown) => {
    if (!stateMap.has(key)) {stateMap.set(key, ref(init()))}
    return stateMap.get(key)!
  }
})

class FakeAudio {
  src = ''
  currentTime = 0
  duration = 0
  volume = 1
  addEventListener() {}
  load = vi.fn()
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
}

const track = { id: 't1', title: 'Track', artist: 'Artist', album: 'Album', duration: 200, artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }

describe('decodeVisualizerPreset', () => {
  it('defaults when nothing is stored', () => {
    expect(decodeVisualizerPreset(null)).toBe(DEFAULT_VISUALIZER_PRESET)
  })

  it('reads a known preset id', () => {
    expect(decodeVisualizerPreset('buddhabrot')).toBe('buddhabrot')
  })

  it('falls back on an id with no shader behind it', () => {
    expect(decodeVisualizerPreset('milkdrop2')).toBe(DEFAULT_VISUALIZER_PRESET)
  })
})

describe('useVisualizer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
    vi.stubGlobal('Audio', FakeAudio)
    localStorage.clear()
    useVisualizer().close()
    useVisualizer().setPreset(DEFAULT_VISUALIZER_PRESET)
  })

  it('starts closed on the default preset', () => {
    const { active, preset } = useVisualizer()
    expect(active.value).toBe(false)
    expect(preset.value).toBe(DEFAULT_VISUALIZER_PRESET)
  })

  // The player store only creates its HTMLAudioElement on first playback, so before a track exists
  // there is nothing to tap and the overlay would render a black screen.
  it('refuses to open with no current track', () => {
    const { active, available, open } = useVisualizer()
    expect(available.value).toBe(false)
    open()
    expect(active.value).toBe(false)
  })

  it('opens, toggles and closes once a track is playing', async () => {
    const player = usePlayerStore()
    await player.playTrack({ ...track } as never)

    const { active, available, open, toggle, close } = useVisualizer()
    expect(available.value).toBe(true)

    open()
    expect(active.value).toBe(true)

    toggle()
    expect(active.value).toBe(false)

    toggle()
    expect(active.value).toBe(true)

    close()
    expect(active.value).toBe(false)
  })

  it('persists a chosen preset so the next session opens on it', () => {
    const { preset, setPreset } = useVisualizer()
    setPreset('fractal')
    expect(preset.value).toBe('fractal')
    expect(localStorage.getItem(VISUALIZER_STORAGE_KEY)).toBe('fractal')
  })

  it('ignores an unknown preset rather than storing one with no shader', () => {
    const { preset, setPreset } = useVisualizer()
    setPreset('buddhabrot')
    setPreset('milkdrop2' as never)
    expect(preset.value).toBe('buddhabrot')
  })

  it('nextPreset walks the switcher order and wraps', () => {
    const { preset, presets, setPreset, nextPreset } = useVisualizer()
    setPreset(presets[presets.length - 1]!.id)

    nextPreset()

    expect(preset.value).toBe(presets[0]!.id)
  })

  it('survives localStorage throwing (private mode) - the choice still applies for the session', () => {
    const { preset, setPreset } = useVisualizer()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => setPreset('buddhabrot')).not.toThrow()
    expect(preset.value).toBe('buddhabrot')

    setItem.mockRestore()
  })
})
