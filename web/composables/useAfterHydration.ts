import { getCurrentInstance, nextTick, onMounted } from 'vue'

// Runs `fn` once it is safe to write client-only state (localStorage) into a Pinia setup store:
// after Nuxt hydration, so the server-rendered DOM is not contradicted mid-hydrate, and after
// Pinia's own post-setup patch from the SSR payload, which would otherwise overwrite whatever `fn`
// wrote (see the restore comment in stores/player.ts).
//
// Three cases, depending on who first creates the store:
// - during hydration (a plugin, or a component in the initial render) → Nuxt's hydration-done hook
// - later, inside a component's setup() → onMounted
// - later, outside any component → next tick, which is already past Pinia's synchronous patch
export const useAfterHydration = (fn: () => void) => {
  const nuxtApp = useNuxtApp()
  if (nuxtApp.isHydrating) {
    nuxtApp.hooks.hookOnce('app:suspense:resolve', fn)
  }
  else if (getCurrentInstance()) {
    onMounted(fn)
  }
  else {
    nextTick(fn)
  }
}
