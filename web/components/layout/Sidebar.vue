<script setup lang="ts">
import {
  Home,
  Library,
  Compass,
  Clock,
  ListMusic,
  Heart,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  AlertTriangle,
  FlaskConical,
} from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const { logout, hasPerm, isAdmin } = useAuth()
const player = usePlayerStore()
const route = useRoute()

const collapsed = ref(false)

const canViewIssues = hasPerm('issues.view')
const canViewPlaylists = hasPerm('playlists.view')
const canViewFavorites = hasPerm('favorites.view')

const navItems = computed(() => {
  const items = [
    { to: '/', label: 'Home', icon: Home, show: true },
    { to: '/browse', label: 'Browse', icon: Library, show: true },
    { to: '/explore', label: 'Explore', icon: Compass, show: true },
    { to: '/timeline', label: 'Timeline', icon: Clock, show: true },
    { to: '/playlists', label: 'Playlists', icon: ListMusic, show: canViewPlaylists.value },
    { to: '/favorites', label: 'Favorites', icon: Heart, show: canViewFavorites.value },
    { to: '/issues', label: 'Issues', icon: AlertTriangle, show: canViewIssues.value },
    { to: '/labs', label: 'Labs', icon: FlaskConical, show: true },
  ]
  return items.filter((i) => i.show)
})


const isActive = (path: string) => {
  if (path === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(path)
}
</script>

<template>
  <aside
    :data-collapsed="collapsed || undefined"
    class="group/sidebar fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-zinc-800 bg-zinc-950 transition-all duration-200"
    :class="collapsed ? 'w-16' : 'w-56'"
  >
    <div class="flex h-14 items-center justify-between px-3">
      <LayoutLogo />
      <button
        class="rounded-md p-1 text-zinc-400 hover:text-zinc-50 transition-opacity duration-200 group-data-collapsed/sidebar:hidden"
        @click="collapsed = !collapsed"
      >
        <PanelLeftClose :size="18" />
      </button>
      <button
        v-if="collapsed"
        class="rounded-md p-1 text-zinc-400 hover:text-zinc-50"
        @click="collapsed = !collapsed"
      >
        <PanelLeft :size="18" />
      </button>
    </div>

    <nav class="mt-2 flex flex-1 flex-col gap-1 px-2">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        :class="
          isActive(item.to)
            ? 'bg-zinc-800 text-amber-500'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50'
        "
      >
        <component :is="item.icon" :size="20" class="shrink-0" />
        <span class="transition-opacity duration-200 group-data-collapsed/sidebar:hidden">
          {{ item.label }}
        </span>
      </NuxtLink>
    </nav>

    <div class="px-2 transition-all duration-200" :class="player.isVisible ? 'mb-28' : 'mb-4'">
      <NuxtLink
        to="/statistics"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        :class="
          isActive('/statistics')
            ? 'bg-zinc-800 text-amber-500'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50'
        "
      >
        <BarChart3 :size="20" class="shrink-0" />
        <span class="transition-opacity duration-200 group-data-collapsed/sidebar:hidden">
          Statistics
        </span>
      </NuxtLink>
      <NuxtLink
        v-if="isAdmin"
        to="/settings/library"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        :class="
          isActive('/settings')
            ? 'bg-zinc-800 text-amber-500'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50'
        "
      >
        <Settings :size="20" class="shrink-0" />
        <span class="transition-opacity duration-200 group-data-collapsed/sidebar:hidden">
          Settings
        </span>
      </NuxtLink>
      <button
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
        @click="logout"
      >
        <LogOut :size="20" class="shrink-0" />
        <span class="transition-opacity duration-200 group-data-collapsed/sidebar:hidden">
          Sign out
        </span>
      </button>
    </div>
  </aside>
</template>
