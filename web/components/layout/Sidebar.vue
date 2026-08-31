<script setup lang="ts">
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  Clock,
  Compass,
  DownloadCloud,
  FlaskConical,
  Heart,
  Home,
  Library,
  ListMusic,
  LogOut,
  Settings,
} from 'lucide-vue-next'
import { useGlobalStore } from '~/stores/global'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

const { logout, hasPerm, isAdmin } = useAuth()
const global = useGlobalStore()
const route = useRoute()
const { collapsed, toggle } = useSidebar()

const canViewIssues = hasPerm('issues.view')
const canViewPlaylists = hasPerm('playlists.view')
const canViewFavorites = hasPerm('favorites.view')
const canViewDownloads = hasPerm('sync.view')

interface NavEntry {
  to?: string
  activePath?: string
  label: string
  icon: typeof Home
  count?: number | null
  action?: () => void
}

const navItems = computed<NavEntry[]>(() => [
  { to: '/', label: 'Home', icon: Home },
  { to: '/browse', label: 'Browse', icon: Library, count: global.stats.artists },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/timeline', label: 'Timeline', icon: Clock },
  ...(canViewPlaylists.value ? [{ to: '/playlists', label: 'Playlists', icon: ListMusic, count: global.stats.playlists }] : []),
  ...(canViewFavorites.value ? [{ to: '/favorites', label: 'Favorites', icon: Heart, count: global.stats.favorites }] : []),
  ...(canViewDownloads.value ? [{ to: '/downloads', label: 'Downloads', icon: DownloadCloud }] : []),
  { to: '/labs', label: 'Labs', icon: FlaskConical },
])

const footerItems = computed<NavEntry[]>(() => [
  { to: '/statistics', label: 'Statistics', icon: BarChart3 },
  ...(canViewIssues.value ? [{ to: '/issues', label: 'Issues', icon: AlertTriangle, count: global.stats.issues }] : []),
  ...(isAdmin.value ? [{ to: '/settings/library', activePath: '/settings', label: 'Settings', icon: Settings }] : []),
  { label: 'Sign out', icon: LogOut, action: logout },
])

const isActive = (item: NavEntry) => {
  const path = item.activePath ?? item.to
  if (!path) {
    return false
  }
  return path === '/' ? route.path === '/' : route.path.startsWith(path)
}
</script>

<template>
  <aside class="flex h-full flex-col overflow-hidden border-r border-stone-100/6 bg-stone-950 transition-all duration-200">
    <div :class="cx('flex items-center gap-2 px-3 py-3 mb-5', collapsed ? 'flex-col' : 'justify-between')">
      <LayoutLogo />
      <button
        type="button"
        class="grid size-8 place-items-center rounded-sm border border-transparent text-stone-100/50 transition-colors duration-150 hover:border-stone-100/10 hover:bg-stone-800 hover:text-stone-100/60"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      >
        <ChevronLeft :size="16" :stroke-width="ICON_STROKE_WIDTH" class="transition-transform duration-200" :class="collapsed && 'rotate-180'" />
      </button>
    </div>

    <nav class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2" aria-label="Primary">
      <LayoutSidebarItem
        v-for="item in navItems"
        :key="item.label"
        :to="item.to"
        :label="item.label"
        :icon="item.icon"
        :count="item.count"
        :collapsed="collapsed"
        :active="isActive(item)"
      />
    </nav>

    <nav class="mb-4 mt-3 flex flex-col gap-0.5 border-t border-stone-100/6 px-2 pt-3" aria-label="System">
      <LayoutSidebarItem
        v-for="item in footerItems"
        :key="item.label"
        :to="item.to"
        :label="item.label"
        :icon="item.icon"
        :count="item.count"
        :collapsed="collapsed"
        :active="isActive(item)"
        @click="item.action?.()"
      />
    </nav>
  </aside>
</template>
