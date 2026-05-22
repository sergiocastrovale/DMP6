import { defineStore } from 'pinia'

interface AppStats {
  artists: number
  releases: number
  tracks: number
  playtime: number
  playlists: number
  favorites: number
  issues: number
}

const DEFAULT_STATS: AppStats = {
  artists: 0,
  releases: 0,
  tracks: 0,
  playtime: 0,
  playlists: 0,
  favorites: 0,
  issues: 0,
}

export const useGlobalStore = defineStore('global', () => {
  const stats = ref<AppStats>({ ...DEFAULT_STATS })
  const loaded = ref(false)

  const playtimeHours = computed(() => Math.floor(stats.value.playtime / 3600))
  const playtimeMinutes = computed(() => Math.floor((stats.value.playtime % 3600) / 60))

  const fetch = async () => {
    try {
      const data = await $fetch<AppStats>('/api/app-stats')
      stats.value = data
      loaded.value = true
    }
    catch (error) {
      console.error('Failed to load app stats:', error)
    }
  }

  const refresh = async () => {
    await fetch()
  }

  return { stats, loaded, playtimeHours, playtimeMinutes, fetch, refresh }
})
