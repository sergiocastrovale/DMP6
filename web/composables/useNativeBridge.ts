// Bridge to the Capacitor Android shell. The web app is the SAME bundle whether served in a
// browser (PWA) or inside the native WebView, so every call is guarded: in a plain browser
// window.Capacitor is undefined and these are no-ops. Inside the Android WebView the custom
// ForegroundService plugin keeps audio alive while backgrounded (see docs/pwa_capacitor_android.md).
import type { ForegroundServicePlugin, CapacitorGlobal } from '~/types/player'

const capacitor = (): CapacitorGlobal | undefined => {
  if (typeof window === 'undefined') {
    return undefined
  }
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
}

export const useNativeBridge = () => {
  const isNative = (): boolean => capacitor()?.isNativePlatform?.() ?? false

  const foregroundService = (): ForegroundServicePlugin | undefined => capacitor()?.Plugins?.ForegroundService

  const startPlaybackService = (title?: string): void => {
    foregroundService()?.start({ title }).catch(() => {})
  }

  const stopPlaybackService = (): void => {
    foregroundService()?.stop().catch(() => {})
  }

  return { isNative, startPlaybackService, stopPlaybackService }
}
