import { usePlayerStore } from '~/stores/player'
import {
  DEFAULT_VISUALIZER_PRESET, VISUALIZER_STORAGE_KEY, visualizerPresets,
  type VisualizerPresetId,
} from '~/helpers/constants'

const isPresetId = (value: unknown): value is VisualizerPresetId =>
  visualizerPresets.some(p => p.id === value)

/** Decode the stored preset, defaulting anything unrecognised or corrupt. */
export const decodeVisualizerPreset = (raw: string | null): VisualizerPresetId =>
  isPresetId(raw) ? raw : DEFAULT_VISUALIZER_PRESET

/**
 * Whether the fullscreen visualizer is up, and which preset it is drawing.
 *
 * Shared state rather than props for the same reason as useChrome: the toggles happen in place
 * without a route change, and the two triggers (the player bar, Explore's header) live in a
 * different subtree from the overlay, which AppShell mounts at the top level.
 *
 * The real Fullscreen API call is NOT here - requestFullscreen needs an element, so it belongs to
 * components/visualizer/Overlay.vue, which owns one.
 */
export const useVisualizer = () => {
  const player = usePlayerStore()
  const active = useState('visualizer-active', () => false)
  const preset = useState<VisualizerPresetId>('visualizer-preset', () => DEFAULT_VISUALIZER_PRESET)

  // localStorage during setup would crash SSR, and rendering the stored value server-side would be
  // a hydration mismatch - the same split useTheme/useSidebar use.
  onMounted(() => {
    preset.value = decodeVisualizerPreset(localStorage.getItem(VISUALIZER_STORAGE_KEY))
  })

  // Nothing to visualize without a track: the player store only creates its HTMLAudioElement on
  // first playback, so before then there is literally nothing to tap.
  const available = computed(() => !!player.currentTrack)

  const open = () => {
    if (available.value) {
      active.value = true
    }
  }

  const close = () => { active.value = false }

  const toggle = () => (active.value ? close() : open())

  const setPreset = (next: VisualizerPresetId) => {
    if (!isPresetId(next)) {
      return
    }
    preset.value = next
    if (!import.meta.client) {
      return
    }
    try {
      localStorage.setItem(VISUALIZER_STORAGE_KEY, next)
    }
    catch { /* private mode / quota - the choice still applies for this session */ }
  }

  const nextPreset = () => {
    const index = visualizerPresets.findIndex(p => p.id === preset.value)
    setPreset(visualizerPresets[(index + 1) % visualizerPresets.length]!.id)
  }

  return { active, preset, available, presets: visualizerPresets, open, close, toggle, setPreset, nextPreset }
}
