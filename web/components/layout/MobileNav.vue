<script setup lang="ts">
import { Home, Library, Compass, Clock, ListMusic, Heart } from 'lucide-vue-next'

const route = useRoute()
const { hasPerm } = useAuth()

const canViewPlaylists = hasPerm('playlists.view')
const canViewFavorites = hasPerm('favorites.view')

const items = computed(() => {
  const all = [
    { to: '/', label: 'Home', icon: Home, show: true },
    { to: '/browse', label: 'Browse', icon: Library, show: true },
    { to: '/explore', label: 'Explore', icon: Compass, show: true },
    { to: '/timeline', label: 'Timeline', icon: Clock, show: true },
    { to: '/playlists', label: 'Playlists', icon: ListMusic, show: canViewPlaylists.value },
    { to: '/favorites', label: 'Favorites', icon: Heart, show: canViewFavorites.value },
  ]
  return all.filter((i) => i.show)
})

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <nav
    class="fixed bottom-0 left-0 z-40 flex w-full border-t border-rule bg-bg lg:hidden"
  >
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors"
      :class="isActive(item.to) ? 'text-accent' : 'text-ink-3'"
    >
      <component :is="item.icon" :size="20" />
      <span>{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
