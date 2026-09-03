import {
  DEFAULT_THEME, DEFAULT_UI_SIZE, THEME_STORAGE_KEY, themes, uiSizes,
  type ThemeId, type UiSizeId,
} from '~/helpers/constants'

export interface ThemePreference {
  accent: ThemeId
  size: UiSizeId
}

const isThemeId = (value: unknown): value is ThemeId => themes.some(t => t.id === value)
const isUiSizeId = (value: unknown): value is UiSizeId => uiSizes.some(s => s.id === value)

/**
 * Decode whatever is in localStorage into a full preference, defaulting anything unrecognised.
 * Accepts the pre-UI-size format too, where the entry was a bare accent id (`"violet"`).
 */
export const decodeThemePreference = (raw: string | null): ThemePreference => {
  const fallback: ThemePreference = { accent: DEFAULT_THEME, size: DEFAULT_UI_SIZE }
  if (!raw) {
    return fallback
  }
  if (isThemeId(raw)) {
    return { accent: raw, size: DEFAULT_UI_SIZE }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ThemePreference>
    return {
      accent: isThemeId(parsed?.accent) ? parsed.accent : DEFAULT_THEME,
      size: isUiSizeId(parsed?.size) ? parsed.size : DEFAULT_UI_SIZE,
    }
  }
  catch {
    return fallback
  }
}

/**
 * Appearance preferences (Settings → Themes): the accent colour and the UI size multiplier. Both
 * live in one localStorage entry, per browser, never on the server.
 *
 * `<html>` already carries `data-theme`/`data-size` before this runs - the inline head script in
 * nuxt.config.ts applies them pre-paint so the chosen look is up on first render instead of
 * flashing the defaults. This composable mirrors that into SSR-safe shared state (so the pickers
 * can show what's active) and writes both back on a change.
 */
export const useTheme = () => {
  const preference = useState<ThemePreference>('theme', () => ({
    accent: DEFAULT_THEME,
    size: DEFAULT_UI_SIZE,
  }))

  // The server always renders the defaults; the client corrects them on mount. Reading
  // localStorage during setup would crash SSR, and rendering the stored value server-side would be
  // a hydration mismatch - the same split useSidebar/useDismissable use.
  onMounted(() => {
    preference.value = decodeThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
  })

  const persist = () => {
    if (!import.meta.client) {
      return
    }
    document.documentElement.dataset.theme = preference.value.accent
    document.documentElement.dataset.size = preference.value.size
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference.value))
    }
    catch { /* private mode / quota - the choice still applies for this session */ }
  }

  const setAccent = (accent: ThemeId) => {
    if (!isThemeId(accent)) {
      return
    }
    preference.value = { ...preference.value, accent }
    persist()
  }

  const setSize = (size: UiSizeId) => {
    if (!isUiSizeId(size)) {
      return
    }
    preference.value = { ...preference.value, size }
    persist()
  }

  const accent = computed(() => preference.value.accent)
  const size = computed(() => preference.value.size)

  return { preference, accent, size, themes, uiSizes, setAccent, setSize }
}
