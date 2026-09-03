import { DEFAULT_THEME, THEME_STORAGE_KEY, themes, type ThemeId } from '~/helpers/constants'

const isThemeId = (value: unknown): value is ThemeId =>
  themes.some(t => t.id === value)

/**
 * The accent theme (Settings → Themes). Stored per browser in localStorage, never on the server.
 *
 * The `data-theme` attribute is already on `<html>` before this runs - the inline head script in
 * nuxt.config.ts sets it pre-paint so the chosen palette is up on first render instead of flashing
 * amber. This composable only mirrors that value into SSR-safe shared state (so the picker can show
 * which square is active) and writes both back on a change.
 */
export const useTheme = () => {
  const theme = useState<ThemeId>('theme', () => DEFAULT_THEME)

  // The server always renders the default; the client corrects it on mount. Reading localStorage
  // during setup would be an SSR crash, and rendering the stored value server-side would be a
  // hydration mismatch - the same split useSidebar/useDismissable use.
  onMounted(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    theme.value = isThemeId(stored) ? stored : DEFAULT_THEME
  })

  const setTheme = (id: ThemeId) => {
    if (!isThemeId(id)) {return}
    theme.value = id
    if (import.meta.client) {
      document.documentElement.dataset.theme = id
      try {
        localStorage.setItem(THEME_STORAGE_KEY, id)
      }
      catch { /* private mode / quota - the theme still applies for this session */ }
    }
  }

  return { theme, themes, setTheme }
}
