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
  ChevronLeft,
  LogOut,
  AlertTriangle,
  FlaskConical,
  DownloadCloud,
} from 'lucide-vue-next'
import { useGlobalStore } from '~/stores/global'

const { logout, hasPerm, isAdmin } = useAuth()
const global = useGlobalStore()
const route = useRoute()
const { collapsed, toggle } = useSidebar()

const canViewIssues = hasPerm('issues.view')
const canViewPlaylists = hasPerm('playlists.view')
const canViewFavorites = hasPerm('favorites.view')
const canViewDownloads = hasPerm('sync.view')

const formatCount = (n: number) => n.toLocaleString()

const navItems = computed(() => {
  const items = [
    { to: '/', label: 'Home', icon: Home, show: true, count: null },
    { to: '/browse', label: 'Browse', icon: Library, show: true, count: global.stats.artists },
    { to: '/explore', label: 'Explore', icon: Compass, show: true, count: null },
    { to: '/timeline', label: 'Timeline', icon: Clock, show: true, count: null },
    { to: '/playlists', label: 'Playlists', icon: ListMusic, show: canViewPlaylists.value, count: global.stats.playlists },
    { to: '/favorites', label: 'Favorites', icon: Heart, show: canViewFavorites.value, count: global.stats.favorites },
    { to: '/downloads', label: 'Downloads', icon: DownloadCloud, show: canViewDownloads.value, count: null },
    { to: '/labs', label: 'Labs', icon: FlaskConical, show: true, count: null },
  ]
  return items.filter((i) => i.show)
})

const isActive = (path: string) => path === '/' ? route.path === '/' : route.path.startsWith(path)
</script>

<template>
  <aside
    class="flex h-full flex-col border-r border-rule bg-bg overflow-hidden transition-all duration-200"
  >
    <div class="flex items-center gap-2 px-3 py-3 mb-5" :class="collapsed ? 'flex-col' : 'justify-between'">
      <LayoutLogo />
      <button
        class="w-8 h-8 rounded grid place-items-center text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink hover:border hover:border-rule"
        @click="toggle"
      >
        <ChevronLeft
          :size="16"
          class="transition-transform duration-200"
          :class="collapsed ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <nav class="flex flex-1 flex-col gap-3 px-2 overflow-y-auto">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
        :class="[
          isActive(item.to)
            ? 'bg-accent-soft text-accent'
            : 'text-ink-2 hover:bg-bg-2 hover:text-ink',
          collapsed ? 'justify-center px-0' : '',
        ]"
      >
        <span
          v-if="isActive(item.to)"
          class="absolute top-2 bottom-2 w-0.5 bg-accent"
          :class="collapsed ? 'left-0' : 'left-[-14px]'"
        />
        <component :is="item.icon" :size="20" class="shrink-0" />
        <span v-if="!collapsed" class="flex-1 truncate">{{ item.label }}</span>
        <span
          v-if="!collapsed && item.count !== null && item.count > 0"
          class="font-mono text-[11px]"
          :class="isActive(item.to) ? 'text-accent opacity-80' : 'text-ink-4'"
        >
          {{ formatCount(item.count) }}
        </span>
      </NuxtLink>
    </nav>

    <div class="border-t border-rule pt-3 mt-3 px-2 mb-4">
      <NuxtLink
        to="/statistics"
        class="relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
        :class="[
          isActive('/statistics')
            ? 'bg-accent-soft text-accent'
            : 'text-ink-2 hover:bg-bg-2 hover:text-ink',
          collapsed ? 'justify-center px-0' : '',
        ]"
      >
        <span
          v-if="isActive('/statistics')"
          class="absolute top-2 bottom-2 w-0.5 bg-accent"
          :class="collapsed ? 'left-0' : 'left-[-14px]'"
        />
        <BarChart3 :size="20" class="shrink-0" />
        <span v-if="!collapsed">Statistics</span>
      </NuxtLink>
      <NuxtLink
        v-if="canViewIssues"
        to="/issues"
        class="relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
        :class="[
          isActive('/issues')
            ? 'bg-accent-soft text-accent'
            : 'text-ink-2 hover:bg-bg-2 hover:text-ink',
          collapsed ? 'justify-center px-0' : '',
        ]"
      >
        <span
          v-if="isActive('/issues')"
          class="absolute top-2 bottom-2 w-0.5 bg-accent"
          :class="collapsed ? 'left-0' : 'left-[-14px]'"
        />
        <AlertTriangle :size="20" class="shrink-0" />
        <span v-if="!collapsed" class="flex-1 truncate">Issues</span>
        <span
          v-if="!collapsed && global.stats.issues > 0"
          class="font-mono text-[11px]"
          :class="isActive('/issues') ? 'text-accent opacity-80' : 'text-ink-4'"
        >
          {{ formatCount(global.stats.issues) }}
        </span>
      </NuxtLink>
      <NuxtLink
        v-if="isAdmin"
        to="/settings/library"
        class="relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
        :class="[
          isActive('/settings')
            ? 'bg-accent-soft text-accent'
            : 'text-ink-2 hover:bg-bg-2 hover:text-ink',
          collapsed ? 'justify-center px-0' : '',
        ]"
      >
        <span
          v-if="isActive('/settings')"
          class="absolute top-2 bottom-2 w-0.5 bg-accent"
          :class="collapsed ? 'left-0' : 'left-[-14px]'"
        />
        <Settings :size="20" class="shrink-0" />
        <span v-if="!collapsed">Settings</span>
      </NuxtLink>
      <button
        class="relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink"
        :class="collapsed ? 'justify-center px-0' : ''"
        @click="logout"
      >
        <LogOut :size="20" class="shrink-0" />
        <span v-if="!collapsed">Sign out</span>
      </button>
    </div>
  </aside>
</template>
